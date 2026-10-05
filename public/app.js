const $ = id => document.getElementById(id);

const VAULT_PREFIX = "feelcoin.wallet.v1:";
const PBKDF2_ITERATIONS = 250000;

let core = null;
let currentWallet = null;
let currentWalletName = "";
let networkHeight = 0;


/* =========================================================
   BASIC HELPERS
   ========================================================= */

function cleanName(name) {
  name = String(name || "").trim();

  if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) {
    throw new Error(
      "Wallet name may contain only letters, numbers, dot, dash and underscore."
    );
  }

  return name;
}

function cleanPassword(password) {
  password = String(password || "");

  if (password.length < 8) {
    throw new Error("Use a password of at least 8 characters.");
  }

  return password;
}

function cleanMnemonic(seed) {
  return String(seed || "")
    .trim()
    .replace(/\s+/g, " ");
}

function parseCoreResult(raw) {
  let result;

  try {
    result = typeof raw === "string"
      ? JSON.parse(raw)
      : raw;
  }
  catch {
    throw new Error("Feelcoin crypto engine returned invalid data.");
  }

  if (!result) {
    throw new Error("Feelcoin crypto engine returned no data.");
  }

  if (result.err_msg) {
    throw new Error(result.err_msg);
  }

  if (result.error) {
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : JSON.stringify(result.error)
    );
  }

  return result;
}

function normalizeWallet(w) {
  return {
    address:
      w.address ||
      w.address_string ||
      "",

    mnemonic:
      w.mnemonic ||
      w.mnemonic_string ||
      "",

    seed:
      w.seed ||
      w.seed_string ||
      "",

    privateViewKey:
      w.privateViewKey ||
      w.sec_viewKey_string ||
      w.private_view_key ||
      "",

    publicViewKey:
      w.publicViewKey ||
      w.pub_viewKey_string ||
      w.public_view_key ||
      "",

    privateSpendKey:
      w.privateSpendKey ||
      w.sec_spendKey_string ||
      w.private_spend_key ||
      "",

    publicSpendKey:
      w.publicSpendKey ||
      w.pub_spendKey_string ||
      w.public_spend_key ||
      "",

    restoreHeight:
      Number(w.restoreHeight || 0),

    viewOnly:
      Boolean(w.viewOnly)
  };
}


/* =========================================================
   CLIENT-SIDE ENCRYPTED WALLET VAULT
   ========================================================= */

function bytesToBase64(bytes) {
  let binary = "";

  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }

  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

async function deriveVaultKey(password, salt) {
  const material =
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    material,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptWallet(wallet, password) {
  const salt = crypto.getRandomValues(
    new Uint8Array(16)
  );

  const iv = crypto.getRandomValues(
    new Uint8Array(12)
  );

  const key =
    await deriveVaultKey(
      password,
      salt
    );

  const plaintext =
    new TextEncoder().encode(
      JSON.stringify(wallet)
    );

  const ciphertext =
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv
      },
      key,
      plaintext
    );

  return {
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    cipher: "AES-256-GCM",
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(
      new Uint8Array(ciphertext)
    )
  };
}

async function decryptWallet(vault, password) {
  try {
    const salt =
      base64ToBytes(vault.salt);

    const iv =
      base64ToBytes(vault.iv);

    const ciphertext =
      base64ToBytes(vault.data);

    const key =
      await deriveVaultKey(
        password,
        salt
      );

    const plaintext =
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv
        },
        key,
        ciphertext
      );

    return JSON.parse(
      new TextDecoder().decode(
        plaintext
      )
    );
  }
  catch {
    throw new Error(
      "Wrong password or corrupted local wallet."
    );
  }
}

function vaultKey(name) {
  return VAULT_PREFIX + name;
}

function walletExists(name) {
  return localStorage.getItem(
    vaultKey(name)
  ) !== null;
}

async function saveWallet(name, password, wallet) {
  if (walletExists(name)) {
    throw new Error(
      "A local wallet with this name already exists."
    );
  }

  const encrypted =
    await encryptWallet(
      wallet,
      password
    );

  localStorage.setItem(
    vaultKey(name),
    JSON.stringify(encrypted)
  );
}

async function openSavedWallet(name, password) {
  const raw =
    localStorage.getItem(
      vaultKey(name)
    );

  if (!raw) {
    throw new Error(
      "Wallet not found in this browser."
    );
  }

  let vault;

  try {
    vault = JSON.parse(raw);
  }
  catch {
    throw new Error(
      "Local wallet data is corrupted."
    );
  }

  return normalizeWallet(
    await decryptWallet(
      vault,
      password
    )
  );
}


/* =========================================================
   NETWORK + WASM
   ========================================================= */

async function health() {
  try {
    const response =
      await fetch(
        "/api/health",
        {
          cache: "no-store"
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error();
    }

    networkHeight =
      Number(data.height || 0);

    $("network").textContent =
      `Network Online • Height ${networkHeight}`;
  }
  catch {
    $("network").textContent =
      "Network Offline";
  }
}

async function initializeCore() {
  $("network").textContent =
    "Loading Feelcoin crypto...";

  core =
    await MyMoneroClient({
      locateFile: file =>
        "/wasm/" + file
    });

  await health();
}


/* =========================================================
   WALLET DASHBOARD
   ========================================================= */

function showWallet(name, wallet) {
  currentWallet = wallet;
  currentWalletName = name;

  $("walletName").textContent =
    name;

  /*
   * Balance scanning comes next.
   * Do not display fake wallet balances.
   */
  $("balance").textContent =
    "— FEEL";

  $("unlocked").textContent =
    "— FEEL";

  $("height").textContent =
    networkHeight || "-";

  $("address").textContent =
    wallet.address;

  if ($("qr")) {
    $("qr").style.display = "none";
  }

  $("loginView")
    .classList
    .add("hidden");

  $("walletView")
    .classList
    .remove("hidden");

  $("transactions").textContent =
    "Wallet unlocked locally. Blockchain scanning will be connected in the next step.";

  if ($("sendButton")) {
    $("sendButton").disabled = true;
  }

  if ($("sendMessage")) {
    $("sendMessage").textContent =
      wallet.viewOnly
        ? "View-only wallet • Sending is unavailable."
        : "Client-side transaction scanning/signing is not enabled yet.";
  }
}


/* =========================================================
   CREATE WALLET
   ========================================================= */

$("createButton").onclick =
  async () => {

    $("authMessage").textContent = "";

    try {
      if (!core) {
        throw new Error(
          "Feelcoin crypto engine is still loading."
        );
      }

      const name =
        cleanName(
          $("createName").value
        );

      const password =
        cleanPassword(
          $("createPassword").value
        );

      const generated =
        normalizeWallet(
          parseCoreResult(
            core.newly_created_wallet(
              "en-US",
              "MAINNET"
            )
          )
        );

      if (!generated.address) {
        throw new Error(
          "Wallet generation failed."
        );
      }

      generated.restoreHeight =
        networkHeight;

      generated.viewOnly = false;

      await saveWallet(
        name,
        password,
        generated
      );

      $("createPassword").value = "";

      if ($("seedText")) {
        $("seedText").textContent =
          generated.mnemonic;
      }

      if ($("seedModal")) {
        $("seedModal")
          .classList
          .remove("hidden");
      }

      showWallet(
        name,
        generated
      );
    }
    catch (error) {
      $("authMessage").textContent =
        error.message;
    }
  };


/* =========================================================
   OPEN ENCRYPTED LOCAL WALLET
   ========================================================= */

$("openButton").onclick =
  async () => {

    $("authMessage").textContent = "";

    try {
      const name =
        cleanName(
          $("openName").value
        );

      const password =
        cleanPassword(
          $("openPassword").value
        );

      const wallet =
        await openSavedWallet(
          name,
          password
        );

      $("openPassword").value = "";

      showWallet(
        name,
        wallet
      );
    }
    catch (error) {
      $("authMessage").textContent =
        error.message;
    }
  };


/* =========================================================
   RESTORE FROM RECOVERY SEED
   ========================================================= */

$("restoreSeedButton").onclick =
  async () => {

    $("authMessage").textContent = "";

    try {
      if (!core) {
        throw new Error(
          "Feelcoin crypto engine is still loading."
        );
      }

      const name =
        cleanName(
          $("restoreSeedName").value
        );

      const password =
        cleanPassword(
          $("restoreSeedPassword").value
        );

      const mnemonic =
        cleanMnemonic(
          $("restoreSeedWords").value
        );

      if (!mnemonic) {
        throw new Error(
          "Recovery seed is required."
        );
      }

      const restored =
        normalizeWallet(
          parseCoreResult(
            core.seed_and_keys_from_mnemonic(
              mnemonic,
              "MAINNET"
            )
          )
        );

      if (!restored.address) {
        throw new Error(
          "Unable to restore this recovery seed."
        );
      }

      restored.mnemonic = mnemonic;

      restored.restoreHeight =
        Math.max(
          0,
          Number(
            $("restoreSeedHeight").value ||
            0
          )
        );

      restored.viewOnly = false;

      await saveWallet(
        name,
        password,
        restored
      );

      $("restoreSeedWords").value = "";
      $("restoreSeedPassword").value = "";

      showWallet(
        name,
        restored
      );
    }
    catch (error) {
      $("authMessage").textContent =
        error.message;
    }
  };


/* =========================================================
   RESTORE FROM PRIVATE KEYS
   ========================================================= */

$("restoreKeysButton").onclick =
  async () => {

    $("authMessage").textContent = "";

    try {
      const name =
        cleanName(
          $("restoreKeyName").value
        );

      const password =
        cleanPassword(
          $("restoreKeyPassword").value
        );

      const address =
        String(
          $("restoreKeyAddress").value ||
          ""
        ).trim();

      const spend =
        String(
          $("restoreSpendKey").value ||
          ""
        ).trim();

      const view =
        String(
          $("restoreViewKey").value ||
          ""
        ).trim();

      if (!/^[0-9a-fA-F]{64}$/.test(spend)) {
        throw new Error(
          "Invalid private spend key."
        );
      }

      if (!/^[0-9a-fA-F]{64}$/.test(view)) {
        throw new Error(
          "Invalid private view key."
        );
      }

      const decoded =
        parseCoreResult(
          core.decode_address(
            address,
            "MAINNET"
          )
        );

      /*
       * Ask the native crypto core to verify that the
       * supplied private components belong together.
       */
      const validation =
        parseCoreResult(
          core.validate_components_for_login(
            address,
            view,
            spend,
            "",
            "MAINNET"
          )
        );

      if (
        validation.isValid === false ||
        validation.is_valid === false
      ) {
        throw new Error(
          "Private keys do not match this address."
        );
      }

      const wallet =
        normalizeWallet({
          address,
          privateSpendKey: spend,
          privateViewKey: view,

          publicSpendKey:
            decoded.pub_spendKey_string ||
            decoded.publicSpendKey ||
            "",

          publicViewKey:
            decoded.pub_viewKey_string ||
            decoded.publicViewKey ||
            "",

          restoreHeight:
            Math.max(
              0,
              Number(
                $("restoreKeyHeight").value ||
                0
              )
            ),

          viewOnly: false
        });

      await saveWallet(
        name,
        password,
        wallet
      );

      $("restoreSpendKey").value = "";
      $("restoreViewKey").value = "";
      $("restoreKeyPassword").value = "";

      showWallet(
        name,
        wallet
      );
    }
    catch (error) {
      $("authMessage").textContent =
        error.message;
    }
  };


/* =========================================================
   VIEW-ONLY WALLET
   ========================================================= */

$("restoreViewButton").onclick =
  async () => {

    $("authMessage").textContent = "";

    try {
      const name =
        cleanName(
          $("restoreViewName").value
        );

      const password =
        cleanPassword(
          $("restoreViewPassword").value
        );

      const address =
        String(
          $("restoreViewAddress").value ||
          ""
        ).trim();

      const view =
        String(
          $("restoreOnlyViewKey").value ||
          ""
        ).trim();

      if (!/^[0-9a-fA-F]{64}$/.test(view)) {
        throw new Error(
          "Invalid private view key."
        );
      }

      const decoded =
        parseCoreResult(
          core.decode_address(
            address,
            "MAINNET"
          )
        );

      const wallet =
        normalizeWallet({
          address,

          privateViewKey:
            view,

          publicSpendKey:
            decoded.pub_spendKey_string ||
            decoded.publicSpendKey ||
            "",

          publicViewKey:
            decoded.pub_viewKey_string ||
            decoded.publicViewKey ||
            "",

          privateSpendKey: "",

          restoreHeight:
            Math.max(
              0,
              Number(
                $("restoreViewHeight").value ||
                0
              )
            ),

          viewOnly: true
        });

      await saveWallet(
        name,
        password,
        wallet
      );

      $("restoreOnlyViewKey").value = "";
      $("restoreViewPassword").value = "";

      showWallet(
        name,
        wallet
      );
    }
    catch (error) {
      $("authMessage").textContent =
        error.message;
    }
  };


/* =========================================================
   COPY ADDRESS
   ========================================================= */

$("copyAddress").onclick =
  async () => {

    await navigator.clipboard.writeText(
      $("address").textContent
    );

    $("copyAddress").textContent =
      "Copied";

    setTimeout(
      () => {
        $("copyAddress").textContent =
          "Copy Address";
      },
      1200
    );
  };


/* =========================================================
   REFRESH
   ========================================================= */

$("refreshButton").onclick =
  async () => {

    await health();

    if (currentWallet) {
      $("height").textContent =
        networkHeight || "-";
    }
  };


/* =========================================================
   SEND
   ========================================================= */

$("sendButton").onclick =
  () => {

    /*
     * Intentionally blocked until blockchain scanning,
     * decoy retrieval and Feelcoin transaction signing
     * have been verified against the native daemon.
     */

    $("sendMessage").textContent =
      "Sending is not enabled yet. Transaction signing will be added client-side.";
  };


/* =========================================================
   CLOSE WALLET
   ========================================================= */

$("closeButton").onclick =
  () => {

    currentWallet = null;
    currentWalletName = "";

    location.reload();
  };


/* =========================================================
   SEED MODAL
   ========================================================= */

if ($("seedDone")) {
  $("seedDone").onclick =
    () => {

      $("seedText").textContent = "";

      $("seedModal")
        .classList
        .add("hidden");
    };
}


/* =========================================================
   MAIN TABS
   ========================================================= */

document
  .querySelectorAll(".tab")
  .forEach(tab => {

    tab.onclick = () => {

      const mode =
        tab.dataset.tab;

      document
        .querySelectorAll(".tab")
        .forEach(x =>
          x.classList.remove("active")
        );

      tab.classList.add("active");

      $("createPanel")
        .classList
        .toggle(
          "hidden",
          mode !== "create"
        );

      $("openPanel")
        .classList
        .toggle(
          "hidden",
          mode !== "open"
        );

      $("restorePanel")
        .classList
        .toggle(
          "hidden",
          mode !== "restore"
        );
    };
  });


/* =========================================================
   RESTORE TABS
   ========================================================= */

document
  .querySelectorAll(".restore-tab")
  .forEach(tab => {

    tab.onclick = () => {

      const mode =
        tab.dataset.restore;

      document
        .querySelectorAll(".restore-tab")
        .forEach(x =>
          x.classList.remove("active")
        );

      tab.classList.add("active");

      $("seedRestore")
        .classList
        .toggle(
          "hidden",
          mode !== "seed"
        );

      $("keyRestore")
        .classList
        .toggle(
          "hidden",
          mode !== "keys"
        );

      $("viewRestore")
        .classList
        .toggle(
          "hidden",
          mode !== "view"
        );
    };
  });


/* =========================================================
   NON-CUSTODIAL STATUS
   ========================================================= */

const hero =
  document.querySelector(".hero");

if (hero) {
  const note =
    document.createElement("p");

  note.innerHTML =
    "<strong>Non-Custodial:</strong> seed and private keys stay in this browser. Local wallets are encrypted with your password.";

  hero.appendChild(note);
}


/* =========================================================
   START
   ========================================================= */

initializeCore()
  .catch(error => {
    console.error(error);

    $("network").textContent =
      "Feelcoin crypto failed to load";

    $("authMessage").textContent =
      error.message;
  });

setInterval(
  health,
  15000
);

/* =========================================================
   FEELCOIN NON-CUSTODIAL RUNTIME BRIDGE
   Browser memory only.
   ========================================================= */

window.FeelcoinWalletRuntime = {

  getWallet() {
    return typeof currentWallet !== "undefined"
      ? currentWallet
      : null;
  },

  getWalletName() {
    return typeof currentWalletName !== "undefined"
      ? currentWalletName
      : "";
  },

  getCore() {

    if (window.__feelcoinCore) {
      return window.__feelcoinCore;
    }

    if (
      typeof feelcoinCore !== "undefined"
    ) {
      return feelcoinCore;
    }

    return null;
  }

};
