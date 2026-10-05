(() => {
  "use strict";

  let scanning = false;

  /*
   * Prevent a failed automatic scan from being
   * restarted every 750ms forever.
   * Manual Refresh clears this latch.
   */
  let scanFailedWalletId = "";
  let lastWalletId = "";
  let lastResult = null;

  const $ = id =>
    document.getElementById(id);


  /* =========================================================
     ENCRYPTED LOCAL SCAN CACHE

     - Stored only in this browser.
     - Encrypted with AES-GCM.
     - Encryption key is derived locally from the wallet's
       private view key using HKDF-SHA256.
     - No cache data or key is sent to the VPS.
     ========================================================= */

  const SCAN_CACHE_VERSION = 2;

  const encoder =
    new TextEncoder();

  const decoder =
    new TextDecoder();


  function walletCacheCredentials(wallet) {

    return {

      address:
        wallet?.address ||
        wallet?.address_string ||
        "",

      privateViewKey:
        wallet?.privateViewKey ||
        wallet?.private_view_key ||
        wallet?.sec_viewKey_string ||
        wallet?.viewkey ||
        ""

    };
  }


  function hexBytes(hex) {

    const value =
      String(hex || "");

    if (
      !/^[0-9a-f]{64}$/i.test(
        value
      )
    ) {
      throw new Error(
        "Invalid private view key for scan cache"
      );
    }

    const out =
      new Uint8Array(
        value.length / 2
      );

    for (
      let i = 0;
      i < out.length;
      ++i
    ) {

      out[i] =
        parseInt(
          value.slice(
            i * 2,
            i * 2 + 2
          ),
          16
        );
    }

    return out;
  }


  function bytesHex(buffer) {

    return Array
      .from(
        new Uint8Array(buffer)
      )
      .map(
        byte =>
          byte
            .toString(16)
            .padStart(2, "0")
      )
      .join("");
  }


  function bytesBase64(bytes) {

    let binary = "";

    for (
      const byte
      of bytes
    ) {
      binary +=
        String.fromCharCode(byte);
    }

    return btoa(binary);
  }


  function base64Bytes(value) {

    const binary =
      atob(value);

    const bytes =
      new Uint8Array(
        binary.length
      );

    for (
      let i = 0;
      i < binary.length;
      ++i
    ) {

      bytes[i] =
        binary.charCodeAt(i);
    }

    return bytes;
  }


  async function scanCacheStorageKey(
    address
  ) {

    const digest =
      await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(
          "Feelcoin scan-cache wallet|" +
          address
        )
      );

    return (
      "feelcoin.scan-cache.v2." +
      bytesHex(digest)
    );
  }


  async function deriveScanCacheKey(
    wallet
  ) {

    const credentials =
      walletCacheCredentials(
        wallet
      );

    if (
      !credentials.address ||
      !credentials.privateViewKey
    ) {
      throw new Error(
        "Wallet is missing scan-cache credentials"
      );
    }


    const baseKey =
      await crypto.subtle.importKey(
        "raw",
        hexBytes(
          credentials.privateViewKey
        ),
        "HKDF",
        false,
        [
          "deriveKey"
        ]
      );


    const salt =
      await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(
          credentials.address
        )
      );


    return crypto.subtle.deriveKey(
      {
        name:
          "HKDF",

        hash:
          "SHA-256",

        salt,

        info:
          encoder.encode(
            "Feelcoin browser encrypted scan cache v1"
          )
      },

      baseKey,

      {
        name:
          "AES-GCM",

        length:
          256
      },

      false,

      [
        "encrypt",
        "decrypt"
      ]
    );
  }


  /*
   * JSON does not support BigInt directly.
   * Preserve atomic FEEL values exactly.
   */
  function scanCacheReplacer(
    key,
    value
  ) {

    if (
      typeof value ===
      "bigint"
    ) {

      return {
        __feelcoin_bigint:
          value.toString()
      };
    }


    /*
     * formatAtomic is a function attached to the
     * scanner result. Functions do not belong in
     * persisted state.
     */
    if (
      typeof value ===
      "function"
    ) {
      return undefined;
    }


    return value;
  }


  function scanCacheReviver(
    key,
    value
  ) {

    if (
      value &&
      typeof value ===
        "object" &&
      typeof value
        .__feelcoin_bigint ===
        "string" &&
      /^-?\d+$/.test(
        value.__feelcoin_bigint
      )
    ) {

      return BigInt(
        value.__feelcoin_bigint
      );
    }


    return value;
  }


  function validCachedResult(
    result
  ) {

    if (
      !result ||
      typeof result !==
        "object"
    ) {
      return false;
    }


    if (
      !Number.isSafeInteger(
        Number(
          result.scannedHeight
        )
      ) ||
      Number(
        result.scannedHeight
      ) < 0
    ) {
      return false;
    }


    if (
      !Array.isArray(
        result.ownedOutputs
      ) ||
      !Array.isArray(
        result.incoming
      ) ||
      !Array.isArray(
        result.outgoing
      )
    ) {
      return false;
    }


    return true;
  }


  async function saveScanCache(
    wallet,
    name,
    result
  ) {

    if (
      !wallet ||
      !validCachedResult(
        result
      )
    ) {
      return false;
    }


    const credentials =
      walletCacheCredentials(
        wallet
      );


    if (
      !credentials.address ||
      !credentials.privateViewKey
    ) {
      return false;
    }


    const key =
      await deriveScanCacheKey(
        wallet
      );


    const storageKey =
      await scanCacheStorageKey(
        credentials.address
      );


    const iv =
      crypto.getRandomValues(
        new Uint8Array(12)
      );


    const payload =
      JSON.stringify(
        {
          version:
            SCAN_CACHE_VERSION,

          address:
            credentials.address,

          walletName:
            String(name || ""),

          savedAt:
            Date.now(),

          result: {
            ...result,
            __cacheCheckedThisSession:
              false
          }
        },
        scanCacheReplacer
      );


    const encrypted =
      await crypto.subtle.encrypt(
        {
          name:
            "AES-GCM",

          iv
        },

        key,

        encoder.encode(
          payload
        )
      );


    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version:
          SCAN_CACHE_VERSION,

        iv:
          bytesBase64(iv),

        ciphertext:
          bytesBase64(
            new Uint8Array(
              encrypted
            )
          )
      })
    );


    return true;
  }


  async function loadScanCache(
    wallet
  ) {

    try {

      const credentials =
        walletCacheCredentials(
          wallet
        );


      if (
        !credentials.address ||
        !credentials.privateViewKey
      ) {
        return null;
      }


      const storageKey =
        await scanCacheStorageKey(
          credentials.address
        );


      const raw =
        localStorage.getItem(
          storageKey
        );


      if (!raw) {
        return null;
      }


      const envelope =
        JSON.parse(raw);


      if (
        envelope?.version !==
          SCAN_CACHE_VERSION ||
        typeof envelope?.iv !==
          "string" ||
        typeof envelope
          ?.ciphertext !==
          "string"
      ) {

        localStorage.removeItem(
          storageKey
        );

        return null;
      }


      const key =
        await deriveScanCacheKey(
          wallet
        );


      const plaintext =
        await crypto.subtle.decrypt(
          {
            name:
              "AES-GCM",

            iv:
              base64Bytes(
                envelope.iv
              )
          },

          key,

          base64Bytes(
            envelope.ciphertext
          )
        );


      const payload =
        JSON.parse(
          decoder.decode(
            plaintext
          ),
          scanCacheReviver
        );


      if (
        payload?.version !==
          SCAN_CACHE_VERSION ||
        payload?.address !==
          credentials.address ||
        !validCachedResult(
          payload.result
        )
      ) {

        localStorage.removeItem(
          storageKey
        );

        return null;
      }


      /*
       * Restore the runtime helper stripped during
       * JSON serialization.
       */
      payload.result.formatAtomic =
        FeelcoinScanner
          .formatAtomic;


      return payload.result;

    }
    catch(error) {

      /*
       * Corrupted/tampered/old cache must never
       * prevent opening the wallet. Ignore it and
       * allow a safe blockchain rescan.
       */
      console.warn(
        "Feelcoin encrypted scan cache could not be restored; a fresh scan will be used.",
        error
      );

      return null;
    }
  }



  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function feel(amount) {
    return (
      FeelcoinScanner.formatAtomic(
        amount || 0
      ) + " FEEL"
    );
  }

  function ensureScanStatus() {
    if ($("scanStatus")) {
      return $("scanStatus");
    }

    const el =
      document.createElement("div");

    el.id = "scanStatus";

    el.style.margin = "14px 0";
    el.style.padding = "12px 14px";
    el.style.border =
      "1px solid rgba(255,255,255,.12)";
    el.style.borderRadius = "10px";
    el.style.background =
      "rgba(0,0,0,.20)";
    el.style.fontSize = "13px";
    el.style.opacity = ".9";

    const stats =
      document.querySelector(".stats");

    if (stats) {
      stats.insertAdjacentElement(
        "afterend",
        el
      );
    }

    return el;
  }

  function setStatus(text) {
    const el =
      ensureScanStatus();

    if (el) {
      el.textContent = text;
    }
  }

  function walletIdentifier(
    wallet,
    name
  ) {
    const address =
      wallet?.address ||
      wallet?.address_string ||
      "";

    const height =
      wallet?.restoreHeight ??
      wallet?.restore_height ??
      0;

    return `${name}|${address}|${height}`;
  }

  function renderHistory(result) {
    const box =
      $("transactions");

    if (!box) {
      return;
    }

    const outgoingIds =
      new Set(
        result.outgoing.map(
          tx => tx.txid
        )
      );

    /*
     * Do not display change outputs from our own
     * outgoing transactions as incoming payments.
     */
    const incomingMap =
      new Map();

    for (const tx of result.incoming) {
      if (outgoingIds.has(tx.txid)) {
        continue;
      }

      const existing =
        incomingMap.get(tx.txid);

      if (existing) {
        existing.amount += tx.amount;
      }
      else {
        incomingMap.set(
          tx.txid,
          {
            type: "IN",
            txid: tx.txid,
            height: tx.height,
            timestamp: tx.timestamp,
            amount: tx.amount,
            coinbase: tx.coinbase
          }
        );
      }
    }

    const history = [
      ...incomingMap.values(),

      ...result.outgoing.map(
        tx => ({
          type: "OUT",
          ...tx
        })
      )
    ].sort(
      (a, b) =>
        Number(b.height || 0) -
        Number(a.height || 0)
    );

    if (!history.length) {
      box.textContent =
        "No transactions found.";
      return;
    }

    box.innerHTML =
      history
        .slice(0, 50)
        .map(tx => {

          const amount =
            feel(tx.amount);

          const fee =
            String(tx.type || "").toLowerCase() === "out" &&
            tx.fee !== undefined
              ? feel(tx.fee)
              : null;

          const date =
            tx.timestamp
              ? new Date(
                  Number(tx.timestamp) *
                  1000
                ).toLocaleString()
              : "";

          return `
<div class="tx">

  <strong>
    ${escapeHTML(String(tx.type || "").toUpperCase())}
    •
    ${escapeHTML(amount)}
  </strong>

  <div class="tx-hash">
    ${escapeHTML(tx.txid)}
  </div>

  <div>
    Height:
    ${escapeHTML(tx.height ?? "-")}
  </div>

  ${
    fee
      ? `<div>Fee: ${escapeHTML(fee)}</div>`
      : ""
  }

  ${
    date
      ? `<div>${escapeHTML(date)}</div>`
      : ""
  }

</div>
          `;
        })
        .join("");
  }

  function renderResult(result) {

    if ($("height")) {
      $("height").textContent =
        result.chainHeight;
    }

    if (result.watchOnly) {

      if ($("balance")) {
        $("balance").textContent =
          "View-only";
      }

      if ($("unlocked")) {
        $("unlocked").textContent =
          "—";
      }

      setStatus(
        `Scan complete • ${result.ownedOutputs.length} owned output(s) detected • View-only wallet: spent status cannot be determined without the private spend key.`
      );
    }
    else {

      if ($("balance")) {
        $("balance").textContent =
          feel(result.balance);
      }

      /*
       * We intentionally do not guess the exact
       * Feelcoin unlock/maturity calculation yet.
       */
      if ($("unlocked")) {
        $("unlocked").textContent =
          feel(result.unlockedBalance);
      }

      setStatus(
        `Synchronized • Height ${result.chainHeight} • ${result.ownedOutputs.length} owned output(s) • ${result.unspent.length} unspent output(s)`
      );
    }

    renderHistory(result);
  }


  async function renderReceiveQR(wallet) {

    const qr =
      $("qr");

    if (
      !qr ||
      !window.FeelcoinQRCode
    ) {
      return;
    }

    const address =
      wallet?.address ||
      wallet?.address_string ||
      "";

    if (!address) {
      return;
    }

    try {

      qr.src =
        await window.FeelcoinQRCode
          .toDataURL(
            address,
            {
              width: 220,
              margin: 1,
              errorCorrectionLevel: "M"
            }
          );

      qr.classList.remove("hidden");
      qr.style.display = "block";

    }
    catch(error) {
      console.error(
        "QR generation failed:",
        error
      );
    }
  }

  async function scanNow(force = false) {

    if (force) {
      scanFailedWalletId = "";
    }


    if (scanning) {
      return;
    }

    const runtime =
      window.FeelcoinWalletRuntime;

    if (
      !runtime ||
      typeof window.FeelcoinScanner ===
        "undefined"
    ) {
      return;
    }

    const wallet =
      runtime.getWallet();

    const core =
      runtime.getCore();

    const name =
      runtime.getWalletName();

    if (!wallet || !core) {
      return;
    }

    await renderReceiveQR(wallet);

    const id =
      walletIdentifier(
        wallet,
        name
      );


    /*
     * A wallet has just been opened in this page.
     * Try restoring its encrypted local scan state
     * before touching the blockchain.
     */
    if (
      id !== lastWalletId ||
      !lastResult
    ) {

      const cached =
        await loadScanCache(
          wallet
        );


      if (cached) {

        lastResult =
          cached;

        lastWalletId =
          id;

        /*
         * Immediately display the last known wallet
         * state while we check for newer blocks.
         */
        renderResult(
          cached
        );

      }
    }


    if (
      !force &&
      id === lastWalletId &&
      lastResult
    ) {

      /*
       * A restored cache still needs one incremental
       * network check. Do not simply return when this
       * invocation is the wallet's first scan.
       */
      if (
        lastResult
          .__cacheCheckedThisSession ===
          true
      ) {
        return;
      }

    }


    /*
     * If we already have cached/live wallet state,
     * keep it visible while synchronization happens
     * silently in the background.
     */
    const hadPreviousState =
      !!lastResult;

    scanning = true;

    const refresh =
      $("refreshButton");

    if (refresh) {
      refresh.disabled = true;
      refresh.textContent =
        hadPreviousState
          ? "Syncing…"
          : "Scanning…";
    }

    /*
     * First ever scan:
     * there is nothing useful to display yet,
     * so showing scan progress is appropriate.
     *
     * Existing wallet:
     * preserve the previous values on screen.
     */
    if (!hadPreviousState) {

      if ($("balance")) {
        $("balance").textContent =
          "0 FEEL";
      }

      if ($("unlocked")) {
        $("unlocked").textContent =
          "0 FEEL";
      }

      if ($("transactions")) {
        $("transactions").textContent =
          "";
      }

    }
    else {

      setStatus(
        "Syncing in background…"
      );

    }

    try {

      const result =
        await FeelcoinScanner.scanWallet({

          core,

          wallet,

          /*
           * Reuse the previous scan only when the
           * exact same wallet remains open.
           */
          previousResult:
            id === lastWalletId
              ? lastResult
              : null,

          onProgress(progress) {

            const current =
              Number(
                progress.scannedHeight ||
                0
              );

            const total =
              Number(
                progress.chainHeight ||
                0
              );

            const pct =
              total > 0
                ? Math.min(
                    100,
                    Math.floor(
                      current /
                      total *
                      100
                    )
                  )
                : 100;

            if (!hadPreviousState) {

              setStatus(
                `Scanning blockchain… ${current} / ${total} • ${pct}% • ${progress.ownedOutputs} owned output(s)`
              );

              if ($("height")) {
                $("height").textContent =
                  `${current} / ${total}`;
              }

            }
            else {

              /*
               * Existing values remain visible.
               * Only this small status indicator changes.
               */
              setStatus(
                "Syncing in background…"
              );

            }
          }

        });

      /*
       * Mark that this persisted/restored state has
       * now been checked against the live chain in
       * the current browser session.
       */
      result.__cacheCheckedThisSession =
        true;


      lastResult =
        result;

      lastWalletId =
        id;


      renderResult(
        result
      );


      /*
       * Persist the latest synchronized state.
       * Failure to cache is non-fatal: the wallet
       * remains usable and simply rescans next time.
       */
      try {

        await saveScanCache(
          wallet,
          name,
          result
        );

      }
      catch(cacheError) {

        console.warn(
          "Feelcoin scan state could not be saved locally:",
          cacheError
        );

      }
    }
    catch(error) {

      scanFailedWalletId = id;

      console.error(
        "Feelcoin scan failed:",
        error
      );

      if (hadPreviousState) {

        /*
         * Behave like a normal wallet:
         * preserve the last synchronized state if
         * a background refresh temporarily fails.
         */
        setStatus(
          "Sync delayed • showing last synchronized state"
        );

      }
      else {

        setStatus(
          `Wallet scan error: ${error.message}`
        );

        if ($("balance")) {
          $("balance").textContent =
            "Unavailable";
        }

        if ($("unlocked")) {
          $("unlocked").textContent =
            "Unavailable";
        }

        if ($("transactions")) {
          $("transactions").textContent =
            error.message;
        }

      }
    }
    finally {

      scanning = false;

      if (refresh) {
        refresh.disabled = false;
        refresh.textContent =
          "Refresh";
      }
    }
  }

  /*
   * Replace old Refresh behavior with the
   * non-custodial browser scanner.
   */
  function attachRefresh() {

    const button =
      $("refreshButton");

    if (!button) {
      return;
    }

    button.onclick =
      () => scanNow(true);
  }

  /*
   * Detect when Create/Open/Restore has put a
   * wallet into browser memory.
   */
  function watchWallet() {

    const runtime =
      window.FeelcoinWalletRuntime;

    if (!runtime) {
      return;
    }

    const wallet =
      runtime.getWallet();

    if (!wallet) {
      return;
    }

    const id =
      walletIdentifier(
        wallet,
        runtime.getWalletName()
      );

    if (
      id &&
      id !== lastWalletId &&
      id !== scanFailedWalletId &&
      !scanning
    ) {
      scanNow(false);
    }
  }

  /*
   * =========================================================
   * AUTOMATIC NEW-BLOCK WATCHER
   *
   * Checks daemon height periodically.
   *
   * It does NOT continuously rescan the blockchain.
   * A scan is triggered only when the chain height changes.
   * scanWallet() then processes only the missing blocks.
   * =========================================================
   */

  let autoCheckBusy = false;


  async function checkForNewBlocks() {

    if (
      autoCheckBusy ||
      scanning ||
      !lastResult
    ) {
      return;
    }


    const runtime =
      window
        .FeelcoinWalletRuntime;


    if (!runtime) {
      return;
    }


    const wallet =
      runtime.getWallet();


    if (!wallet) {
      return;
    }


    const id =
      walletIdentifier(
        wallet,
        runtime.getWalletName()
      );


    /*
     * Never reuse scanner state from another wallet.
     */
    if (
      !id ||
      id !== lastWalletId
    ) {
      return;
    }


    autoCheckBusy =
      true;


    try {

      const response =
        await fetch(
          "/api/health",
          {
            credentials:
              "same-origin",

            cache:
              "no-store"
          }
        );


      if (!response.ok) {
        return;
      }


      const health =
        await response.json();


      const networkHeight =
        Number(
          health.height || 0
        );


      const walletHeight =
        Number(
          lastResult
            .scannedHeight || 0
        );


      if (
        !Number.isSafeInteger(
          networkHeight
        ) ||
        networkHeight < 0
      ) {
        return;
      }


      /*
       * Height changed:
       *
       * normal case:
       *   3094 -> 3095
       *
       * or unusual chain rollback:
       *   3095 -> 3094
       *
       * scanWallet() handles either case safely.
       */
      if (
        networkHeight !==
        walletHeight
      ) {

        await scanNow(true);

      }

    }
    catch(error) {

      /*
       * Network polling failure must never destroy
       * the currently displayed wallet state.
       */
      console.debug(
        "Feelcoin automatic block check failed:",
        error
      );

    }
    finally {

      autoCheckBusy =
        false;

    }

  }


  window.FeelcoinDashboard = {
    scanNow,
    checkForNewBlocks,

    getLastResult() {
      return lastResult;
    },

    async cacheStatus() {

      const runtime =
        window
          .FeelcoinWalletRuntime;

      const wallet =
        runtime
          ?.getWallet?.();


      if (!wallet) {

        return {
          walletOpen:
            false,

          encryptedCache:
            false
        };
      }


      const credentials =
        walletCacheCredentials(
          wallet
        );

      const storageKey =
        credentials.address
          ? await scanCacheStorageKey(
              credentials.address
            )
          : null;


      const raw =
        storageKey
          ? localStorage.getItem(
              storageKey
            )
          : null;


      return {
        walletOpen:
          true,

        encryptedCache:
          !!raw,

        scannedHeight:
          lastResult
            ?.scannedHeight ??
          null,

        lastBlockHash:
          lastResult
            ?.lastBlockHash ??
          null
      };
    }
  };

  attachRefresh();

  setInterval(
    watchWallet,
    750
  );


  /*
   * New blocks normally arrive around every
   * two minutes, so a 10-second lightweight
   * height check is more than sufficient.
   */
  setInterval(
    checkForNewBlocks,
    10000
  );


  /*
   * Check shortly after wallet initialization too.
   */
  setTimeout(
    checkForNewBlocks,
    3000
  );

})();
