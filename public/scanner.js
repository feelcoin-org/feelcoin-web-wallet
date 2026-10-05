(() => {
  "use strict";

  const ATOMIC = 1000000000000n;
  const BATCH_BLOCKS = 50;
  const TX_BATCH = 100;


  function isOutputUnlocked(
    output,
    chainHeight
  ) {
    const cfg =
      window.FEELCOIN_NETWORK || {
        spendableAge: 10,
        maxBlockNumber: 500000000,
        unlockDeltaBlocks: 1,
        unlockDeltaSeconds: 120
      };

    const height =
      Number(output.height || 0);

    if (
      height +
      Number(cfg.spendableAge) >
      Number(chainHeight)
    ) {
      return false;
    }

    const unlockTime =
      Number(output.unlockTime || 0);

    if (
      unlockTime <
      Number(cfg.maxBlockNumber)
    ) {
      return (
        Number(chainHeight) -
        1 +
        Number(cfg.unlockDeltaBlocks) >=
        unlockTime
      );
    }

    return (
      Math.floor(Date.now() / 1000) +
      Number(cfg.unlockDeltaSeconds) >=
      unlockTime
    );
  }

  function pick(obj, names) {
    for (const name of names) {
      if (
        obj &&
        obj[name] !== undefined &&
        obj[name] !== null &&
        obj[name] !== ""
      ) {
        return obj[name];
      }
    }
    return null;
  }

  function jsonResult(value) {
    if (typeof value === "string") {
      return JSON.parse(value);
    }
    return value;
  }

  async function getJSON(url) {
    const response = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store"
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error || `HTTP ${response.status}`
      );
    }

    return data;
  }

  async function postJSON(url, body) {
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error || `HTTP ${response.status}`
      );
    }

    return data;
  }

  function bytesToHex(bytes) {
    return Array.from(bytes)
      .map(v => v.toString(16).padStart(2, "0"))
      .join("");
  }

  function readVarint(bytes, pos) {
    let value = 0;
    let shift = 0;

    while (true) {
      if (pos >= bytes.length) {
        throw new Error("Truncated tx-extra varint");
      }

      const b = bytes[pos++];

      value += (b & 0x7f) * (2 ** shift);

      if ((b & 0x80) === 0) {
        break;
      }

      shift += 7;

      if (shift > 49) {
        throw new Error("tx-extra varint too large");
      }
    }

    return [value, pos];
  }

  /*
   * Parse the tx public keys from tx.extra.
   *
   * Tag 1 = primary tx public key
   * Tag 2 = nonce
   * Tag 3 = merge mining tag
   * Tag 4 = additional tx public keys
   */
  function parseTxExtra(extra) {
    const bytes = Array.isArray(extra) ? extra : [];

    let pos = 0;
    let primary = "";
    const additional = [];

    while (pos < bytes.length) {
      const tag = bytes[pos++];

      if (tag === 0) {
        while (
          pos < bytes.length &&
          bytes[pos] === 0
        ) {
          pos++;
        }
        continue;
      }

      if (tag === 1) {
        if (pos + 32 > bytes.length) {
          break;
        }

        primary =
          bytesToHex(
            bytes.slice(pos, pos + 32)
          );

        pos += 32;
        continue;
      }

      if (tag === 2) {
        let length;

        [length, pos] =
          readVarint(bytes, pos);

        pos += length;
        continue;
      }

      if (tag === 3) {
        let depth;

        [depth, pos] =
          readVarint(bytes, pos);

        // merge-mining merkle root
        if (pos + 32 > bytes.length) {
          break;
        }

        pos += 32;
        continue;
      }

      if (tag === 4) {
        let count;

        [count, pos] =
          readVarint(bytes, pos);

        for (
          let i = 0;
          i < count;
          ++i
        ) {
          if (pos + 32 > bytes.length) {
            break;
          }

          additional.push(
            bytesToHex(
              bytes.slice(
                pos,
                pos + 32
              )
            )
          );

          pos += 32;
        }

        continue;
      }

      /*
       * Unknown tx-extra field.
       * Do not guess its length.
       */
      break;
    }

    return {
      primary,
      additional
    };
  }

  function getOutputKey(vout) {
    const target =
      vout?.target || {};

    if (target.tagged_key?.key) {
      return target.tagged_key.key;
    }

    if (typeof target.key === "string") {
      return target.key;
    }

    if (target.key?.key) {
      return target.key.key;
    }

    return null;
  }

  function getInputKeyImages(tx) {
    const images = [];

    for (const input of tx?.vin || []) {
      const image =
        input?.key?.k_image;

      if (
        typeof image === "string" &&
        /^[0-9a-f]{64}$/i.test(image)
      ) {
        images.push(
          image.toLowerCase()
        );
      }
    }

    return images;
  }

  function findKeyImage(value) {
    if (!value) {
      return null;
    }

    if (
      typeof value === "string" &&
      /^[0-9a-f]{64}$/i.test(value)
    ) {
      return value.toLowerCase();
    }

    if (
      typeof value !== "object"
    ) {
      return null;
    }

    const preferred = [
      "key_image",
      "keyImage",
      "key_image_string",
      "keyImage_string"
    ];

    for (const name of preferred) {
      if (
        typeof value[name] === "string" &&
        /^[0-9a-f]{64}$/i.test(
          value[name]
        )
      ) {
        return value[name].toLowerCase();
      }
    }

    for (
      const [name, child]
      of Object.entries(value)
    ) {
      if (
        /key.*image|image.*key/i.test(name)
      ) {
        const found =
          findKeyImage(child);

        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  function formatAtomic(value) {
    const n = BigInt(value || 0);

    const whole =
      n / ATOMIC;

    let fractional =
      (n % ATOMIC)
        .toString()
        .padStart(12, "0")
        .replace(/0+$/, "");

    return fractional
      ? `${whole}.${fractional}`
      : `${whole}`;
  }

  function walletKeys(wallet) {
    const address =
      pick(wallet, [
        "address",
        "address_string"
      ]);

    const privateViewKey =
      pick(wallet, [
        "privateViewKey",
        "sec_viewKey_string",
        "private_view_key",
        "viewkey"
      ]);

    const privateSpendKey =
      pick(wallet, [
        "privateSpendKey",
        "sec_spendKey_string",
        "private_spend_key",
        "spendkey"
      ]);

    let publicSpendKey =
      pick(wallet, [
        "publicSpendKey",
        "pub_spendKey_string",
        "public_spend_key"
      ]);

    const restoreHeight =
      Math.max(
        0,
        Number(
          pick(wallet, [
            "restoreHeight",
            "restore_height"
          ]) || 0
        )
      );

    return {
      address,
      privateViewKey,
      privateSpendKey,
      publicSpendKey,
      restoreHeight
    };
  }

  function resolvePublicSpendKey(
    core,
    wallet,
    keys
  ) {
    if (keys.publicSpendKey) {
      return keys.publicSpendKey;
    }

    if (!keys.address) {
      throw new Error(
        "Wallet has no address"
      );
    }

    const decoded =
      jsonResult(
        core.decode_address(
          keys.address,
          "MAINNET"
        )
      );

    const publicSpendKey =
      pick(decoded, [
        "pub_spendKey_string",
        "publicSpendKey",
        "public_spend_key",
        "spend_public_key"
      ]);

    if (!publicSpendKey) {
      throw new Error(
        "Unable to obtain wallet public spend key"
      );
    }

    return publicSpendKey;
  }

  function determineUsedTxPublicKey(
    core,
    txKeys,
    outputKey,
    keys,
    outputIndex
  ) {
    const candidates = [];

    if (txKeys.primary) {
      candidates.push(
        txKeys.primary
      );
    }

    if (txKeys.additional[outputIndex]) {
      candidates.push(
        txKeys.additional[outputIndex]
      );
    }

    for (const txPub of candidates) {
      const result =
        jsonResult(
          core.scan_output_ownership(
            txPub,
            outputKey,
            keys.privateViewKey,
            keys.publicSpendKey,
            String(outputIndex)
          )
        );

      if (result?.owned === true) {
        return txPub;
      }
    }

    return null;
  }

  function generateKeyImage(
    core,
    txPublicKey,
    keys,
    outputIndex
  ) {
    if (!keys.privateSpendKey) {
      return null;
    }

    const result =
      jsonResult(
        core.generate_key_image(
          txPublicKey,
          keys.privateViewKey,
          keys.publicSpendKey,
          keys.privateSpendKey,
          String(outputIndex)
        )
      );

    if (result?.err_msg) {
      throw new Error(
        result.err_msg
      );
    }

    return findKeyImage(result);
  }

  async function fetchTransactions(
    hashes
  ) {
    const result = [];

    for (
      let i = 0;
      i < hashes.length;
      i += TX_BATCH
    ) {
      const chunk =
        hashes.slice(
          i,
          i + TX_BATCH
        );

      const reply =
        await postJSON(
          "/api/chain/transactions",
          {
            txs_hashes: chunk
          }
        );

      const txs =
        reply.txs || [];

      for (
        let j = 0;
        j < chunk.length;
        ++j
      ) {
        const entry =
          txs[j] || {};

        let raw =
          entry.as_json;

        if (
          !raw &&
          reply.txs_as_json?.[j]
        ) {
          raw =
            reply.txs_as_json[j];
        }

        if (!raw) {
          continue;
        }

        const parsed =
          typeof raw === "string"
            ? JSON.parse(raw)
            : raw;

        result.push({
          txid:
            entry.tx_hash ||
            chunk[j],

          height:
            Number(
              entry.block_height || 0
            ),

          timestamp:
            Number(
              entry.block_timestamp || 0
            ),

          outputIndices:
            entry.output_indices || [],

          tx: parsed
        });
      }
    }

    return result;
  }

  function scanOwnedOutput({
    core,
    tx,
    txid,
    height,
    timestamp,
    outputIndex,
    outputIndices,
    keys,
    isCoinbase
  }) {
    const vout =
      tx.vout?.[outputIndex];

    if (!vout) {
      return null;
    }

    const outputPublicKey =
      getOutputKey(vout);

    if (!outputPublicKey) {
      return null;
    }

    const txKeys =
      parseTxExtra(
        tx.extra || []
      );

    if (!txKeys.primary) {
      return null;
    }

    let owned = false;
    let amount = 0n;

    if (isCoinbase) {
      const usedTxPub =
        determineUsedTxPublicKey(
          core,
          txKeys,
          outputPublicKey,
          keys,
          outputIndex
        );

      if (!usedTxPub) {
        return null;
      }

      owned = true;

      amount =
        BigInt(
          vout.amount || 0
        );

      let keyImage = null;

      if (keys.privateSpendKey) {
        keyImage =
          generateKeyImageCanonical(
            core,
            usedTxPub,
            keys,
            outputIndex
          );
      }

      return {
        txid,
        height,
        timestamp,
        index: outputIndex,
        globalIndex:
          outputIndices?.[outputIndex] ??
          null,
        amount,
        keyImage,
        outputPublicKey,
        txPublicKey: usedTxPub,
        unlockTime:
          Number(
            tx.unlock_time || 0
          ),
        coinbase: true,
        rct: "coinbase",
        spent: false,
        spentHeight: null,
        spentTxid: null
      };
    }

    const rct =
      tx.rct_signatures || {};

    const encryptedAmount =
      rct.ecdhInfo?.[outputIndex]?.amount;

    const commitment =
      rct.outPk?.[outputIndex];

    if (
      !encryptedAmount ||
      !commitment
    ) {
      return null;
    }

    const additional =
      txKeys.additional[outputIndex] || "";

    const decoded =
      jsonResult(
        core.scan_output_rct(
          txKeys.primary,
          additional,
          outputPublicKey,
          keys.privateViewKey,
          keys.publicSpendKey,
          String(outputIndex),
          encryptedAmount,
          commitment
        )
      );

    if (decoded?.err_msg) {
      /*
       * An error for an output not belonging to us
       * should not kill the entire scan.
       */
      return null;
    }

    if (decoded?.owned !== true) {
      return null;
    }

    amount =
      BigInt(decoded.amount);

    const usedTxPub =
      determineUsedTxPublicKey(
        core,
        txKeys,
        outputPublicKey,
        keys,
        outputIndex
      );

    if (!usedTxPub) {
      throw new Error(
        `Owned output ${txid}:${outputIndex} could not resolve its tx public key`
      );
    }

    let keyImage = null;

    if (keys.privateSpendKey) {
      keyImage =
        generateKeyImageCanonical(
          core,
          usedTxPub,
          keys,
          outputIndex
        );
    }

    return {
      txid,
      height,
      timestamp,
      index: outputIndex,
      globalIndex:
        outputIndices?.[outputIndex] ??
        null,
      amount,
      keyImage,
      outputPublicKey,
      txPublicKey: usedTxPub,
      unlockTime:
        Number(
          tx.unlock_time || 0
        ),
      coinbase: false,
      rct: commitment + encryptedAmount,
      spent: false,
      spentHeight: null,
      spentTxid: null
    };
  }


  /* =========================================================
     CANONICAL KEY IMAGE GENERATION

     MyMonero WASM exports:

       generate_key_image(
         txPublicKey,
         privateViewKey,
         publicSpendKey,
         privateSpendKey,
         outputIndex
       )

     All key material stays inside this browser.
     ========================================================= */

  function extractGeneratedKeyImage(
    value
  ) {

    if (
      typeof value === "string"
    ) {

      const text =
        value.trim();


      if (
        /^[0-9a-f]{64}$/i.test(
          text
        )
      ) {
        return text.toLowerCase();
      }


      try {

        return extractGeneratedKeyImage(
          JSON.parse(text)
        );

      }
      catch {}

    }


    if (
      value &&
      typeof value === "object"
    ) {

      const preferred = [
        "retVal",
        "key_image",
        "keyImage",
        "key_image_string",
        "keyImageString"
      ];


      for (
        const key
        of preferred
      ) {

        const candidate =
          value[key];


        if (
          typeof candidate === "string" &&
          /^[0-9a-f]{64}$/i.test(
            candidate
          )
        ) {

          return candidate
            .toLowerCase();

        }

      }


      /*
       * Compatibility fallback for slightly
       * different bridge return field names.
       */
      for (
        const [key, candidate]
        of Object.entries(value)
      ) {

        if (
          /key.*image/i.test(key) &&
          typeof candidate === "string" &&
          /^[0-9a-f]{64}$/i.test(
            candidate
          )
        ) {

          return candidate
            .toLowerCase();

        }

      }

    }


    return null;
  }


  function generateKeyImageCanonical(
    core,
    txPublicKey,
    keys,
    outputIndex
  ) {

    if (
      typeof core?.generate_key_image !==
      "function"
    ) {

      throw new Error(
        "Feelcoin WASM generate_key_image is unavailable"
      );
    }


    if (
      !/^[0-9a-f]{64}$/i.test(
        String(
          txPublicKey || ""
        )
      ) ||
      !/^[0-9a-f]{64}$/i.test(
        String(
          keys.privateViewKey || ""
        )
      ) ||
      !/^[0-9a-f]{64}$/i.test(
        String(
          keys.publicSpendKey || ""
        )
      ) ||
      !/^[0-9a-f]{64}$/i.test(
        String(
          keys.privateSpendKey || ""
        )
      )
    ) {

      throw new Error(
        "Invalid key material for key-image generation"
      );
    }


    const raw =
      core.generate_key_image(
        String(txPublicKey),
        String(keys.privateViewKey),
        String(keys.publicSpendKey),
        String(keys.privateSpendKey),
        String(outputIndex)
      );


    const keyImage =
      extractGeneratedKeyImage(
        raw
      );


    if (!keyImage) {

      console.error(
        "Unexpected generate_key_image response",
        raw
      );

      throw new Error(
        "Unable to generate Feelcoin key image"
      );
    }


    return keyImage;
  }


  async function scanWallet({
    core,
    wallet,
    previousResult = null,
    onProgress = () => {}
  }) {
    if (!core) {
      throw new Error(
        "Feelcoin WASM core is not loaded"
      );
    }

    const health =
      await getJSON(
        "/api/health"
      );

    const chainHeight =
      Number(
        health.height || 0
      );

    const keys =
      walletKeys(wallet);

    if (
      !keys.address ||
      !keys.privateViewKey
    ) {
      throw new Error(
        "Wallet address/private view key missing"
      );
    }

    keys.publicSpendKey =
      resolvePublicSpendKey(
        core,
        wallet,
        keys
      );

    /*
     * Initial scan begins at the wallet restore height.
     *
     * Subsequent scans can continue from the previous
     * browser-side scan state instead of starting over.
     */
    const restoreStart =
      Math.min(
        keys.restoreHeight,
        chainHeight
      );

    let start =
      restoreStart;

    let incremental =
      false;

    let lastBlockHash =
      null;

    let ownedOutputs = [];
    let incoming = [];
    let outgoing = [];

    const ownedByImage =
      new Map();


    /*
     * Reuse previous browser-memory scan state when:
     *
     * - it belongs to the same open wallet
     *   (dashboard guarantees this)
     * - its scanned height is still valid
     * - its arrays are intact
     *
     * We also check the previously scanned chain tip
     * when a hash is available. If it changed, assume
     * a reorg and automatically fall back to a full scan.
     */
    const previousHeight =
      Number(
        previousResult
          ?.scannedHeight
      );

    const previousUsable =
      !!previousResult &&
      Number.isSafeInteger(
        previousHeight
      ) &&
      previousHeight >=
        restoreStart &&
      previousHeight <=
        chainHeight &&
      Array.isArray(
        previousResult
          .ownedOutputs
      ) &&
      Array.isArray(
        previousResult
          .incoming
      ) &&
      Array.isArray(
        previousResult
          .outgoing
      );


    if (previousUsable) {

      let chainStillMatches =
        true;

      /*
       * Verify the last block from the previous
       * scan. This gives us simple reorg protection.
       */
      if (
        previousHeight > 0
      ) {

        try {

          const previousTip =
            await getJSON(
              `/api/chain/blocks?start=${previousHeight - 1}&count=1`
            );

          const currentHash =
            previousTip
              ?.blocks
              ?.[0]
              ?.block_header
              ?.hash ||
            null;


          if (
            previousResult
              .lastBlockHash
          ) {

            chainStillMatches =
              currentHash ===
              previousResult
                .lastBlockHash;

          }


          if (
            chainStillMatches
          ) {

            lastBlockHash =
              currentHash;
          }

        }
        catch(error) {

          console.warn(
            "Could not verify previous Feelcoin scan tip; falling back to full scan.",
            error
          );

          chainStillMatches =
            false;
        }

      }


      if (chainStillMatches) {

        incremental =
          true;

        start =
          previousHeight;

        /*
         * Clone previous browser-memory state.
         * No wallet state is stored on the VPS.
         */
        ownedOutputs =
          previousResult
            .ownedOutputs
            .map(
              output => ({
                ...output
              })
            );

        incoming =
          previousResult
            .incoming
            .map(
              tx => ({
                ...tx
              })
            );

        outgoing =
          previousResult
            .outgoing
            .map(
              tx => ({
                ...tx
              })
            );


        /*
         * Rebuild key-image index so transactions
         * in newly mined blocks can mark older
         * wallet outputs as spent.
         */
        for (
          const output
          of ownedOutputs
        ) {

          if (
            output.keyImage
          ) {

            ownedByImage.set(
              String(
                output.keyImage
              ).toLowerCase(),
              output
            );

          }
        }

      }
      else {

        console.warn(
          "Feelcoin chain tip changed. Performing a safe full wallet rescan."
        );

      }

    }


    let scannedHeight =
      start;

    for (
      let batchStart = start;
      batchStart < chainHeight;
      batchStart += BATCH_BLOCKS
    ) {
      const count =
        Math.min(
          BATCH_BLOCKS,
          chainHeight - batchStart
        );

      const batch =
        await getJSON(
          `/api/chain/blocks?start=${batchStart}&count=${count}`
        );

      const normalTxHashes = [];
      const normalMeta = new Map();

      /*
       * Scan coinbase transactions immediately and
       * collect normal transaction hashes.
       */
      for (const block of batch.blocks) {
        const parsedBlock =
          JSON.parse(
            block.json
          );

        const height =
          Number(
            block.block_header.height
          );

        /*
         * Keep the hash of the newest scanned block.
         * Used to detect a possible chain reorg on
         * the next incremental scan.
         */
        lastBlockHash =
          block
            ?.block_header
            ?.hash ||
          lastBlockHash;

        const timestamp =
          Number(
            block.block_header.timestamp || 0
          );

        const minerTx =
          parsedBlock.miner_tx;

        if (minerTx) {
          for (
            let i = 0;
            i < (minerTx.vout?.length || 0);
            ++i
          ) {
            const owned =
              scanOwnedOutput({
                core,
                tx: minerTx,
                txid:
                  block.miner_tx_hash ||
                  block.block_header.miner_tx_hash,
                height,
                timestamp,
                outputIndex: i,
                outputIndices: [],
                keys,
                isCoinbase: true
              });

            if (owned) {
              ownedOutputs.push(
                owned
              );

              incoming.push({
                type: "in",
                ...owned
              });

              if (owned.keyImage) {
                ownedByImage.set(
                  String(
                    owned.keyImage
                  ).toLowerCase(),
                  owned
                );
              }
            }
          }
        }

        for (
          const hash
          of parsedBlock.tx_hashes || []
        ) {
          normalTxHashes.push(hash);

          normalMeta.set(
            hash,
            {
              height,
              timestamp
            }
          );
        }
      }

      const transactions =
        await fetchTransactions(
          normalTxHashes
        );

      /*
       * Transactions are already in blockchain order
       * within our scanning window.
       */
      for (const item of transactions) {
        const meta =
          normalMeta.get(
            item.txid
          ) || {};

        const height =
          item.height ||
          meta.height ||
          0;

        const timestamp =
          item.timestamp ||
          meta.timestamp ||
          0;

        /*
         * Outputs first.
         * This ensures change from our own tx is known
         * before calculating its outgoing amount.
         */
        const txOwnedOutputs = [];

        for (
          let i = 0;
          i < (item.tx.vout?.length || 0);
          ++i
        ) {
          const owned =
            scanOwnedOutput({
              core,
              tx: item.tx,
              txid: item.txid,
              height,
              timestamp,
              outputIndex: i,
              outputIndices:
                item.outputIndices,
              keys,
              isCoinbase: false
            });

          if (!owned) {
            continue;
          }

          ownedOutputs.push(owned);
          txOwnedOutputs.push(owned);

          incoming.push({
            type: "in",
            ...owned
          });

          if (owned.keyImage) {
            ownedByImage.set(
              owned.keyImage,
              owned
            );
          }
        }

        /*
         * Then inspect transaction inputs for our
         * locally generated key images.
         */
        if (keys.privateSpendKey) {
          const inputImages =
            getInputKeyImages(
              item.tx
            );

          let spentInputTotal = 0n;

          for (const image of inputImages) {
            const owned =
              ownedByImage.get(
                String(image)
                  .toLowerCase()
              );

            if (!owned) {
              continue;
            }

            if (!owned.spent) {
              owned.spent = true;
              owned.spentHeight =
                height;
              owned.spentTxid =
                item.txid;
            }

            spentInputTotal +=
              owned.amount;
          }

          if (spentInputTotal > 0n) {
            const changeTotal =
              txOwnedOutputs.reduce(
                (sum, output) =>
                  sum + output.amount,
                0n
              );

            const fee =
              BigInt(
                item.tx
                  ?.rct_signatures
                  ?.txnFee || 0
              );

            let sent =
              spentInputTotal -
              changeTotal -
              fee;

            if (sent < 0n) {
              sent = 0n;
            }

            outgoing.push({
              type: "out",
              txid: item.txid,
              height,
              timestamp,
              amount: sent,
              fee,
              inputs: spentInputTotal,
              change: changeTotal
            });
          }
        }
      }

      scannedHeight =
        batchStart + count;

      onProgress({
        scannedHeight,
        chainHeight,
        ownedOutputs:
          ownedOutputs.length
      });

      /*
       * Yield briefly to keep browser UI responsive.
       */
      await new Promise(
        resolve =>
          setTimeout(resolve, 0)
      );
    }

    /* =========================================================
       COINBASE GLOBAL INDEX RESOLUTION

       Miner transactions are available directly in block JSON,
       but their global output indices are not included there.

       Resolve those indices from get_transactions so mining
       outputs can later be used as real spendable inputs.
       ========================================================= */

    const unresolvedCoinbaseOutputs =
      ownedOutputs.filter(
        output =>
          output.coinbase === true &&
          (
            output.globalIndex === null ||
            output.globalIndex === undefined
          ) &&
          /^[0-9a-f]{64}$/i.test(
            String(
              output.txid || ""
            )
          )
      );


    if (
      unresolvedCoinbaseOutputs.length
    ) {

      const coinbaseByTx =
        new Map();


      for (
        const output
        of unresolvedCoinbaseOutputs
      ) {

        const txid =
          String(
            output.txid
          ).toLowerCase();


        if (
          !coinbaseByTx.has(
            txid
          )
        ) {

          coinbaseByTx.set(
            txid,
            []
          );

        }


        coinbaseByTx
          .get(txid)
          .push(output);

      }


      const coinbaseTxids =
        [
          ...coinbaseByTx.keys()
        ];


      for (
        let offset = 0;
        offset < coinbaseTxids.length;
        offset += 100
      ) {

        const group =
          coinbaseTxids.slice(
            offset,
            offset + 100
          );


        const transactions =
          await fetchTransactions(
            group
          );


        for (
          const item
          of transactions
        ) {

          const outputs =
            coinbaseByTx.get(
              String(
                item.txid || ""
              ).toLowerCase()
            ) || [];


          for (
            const output
            of outputs
          ) {

            const globalIndex =
              item.outputIndices?.[
                Number(
                  output.index
                )
              ];


            if (
              globalIndex !== null &&
              globalIndex !== undefined
            ) {

              output.globalIndex =
                globalIndex;

            }

          }

        }

      }

    }


    /*
     * AUTHORITATIVE SPENT-STATUS CHECK
     *
     * Local block scanning remains the primary method.
     * This final check asks our own Feelcoin daemon whether
     * each locally-derived key image is already spent.
     *
     * Daemon spent_status:
     *   0 = unspent
     *   1 = spent in blockchain
     *   2 = spent in transaction pool
     */
    if (
      keys.privateSpendKey
    ) {

      const queryable =
        ownedOutputs.filter(
          output =>
            /^[0-9a-f]{64}$/i.test(
              String(
                output.keyImage || ""
              )
            )
        );


      const STATUS_BATCH = 100;


      for (
        let offset = 0;
        offset < queryable.length;
        offset += STATUS_BATCH
      ) {

        const outputs =
          queryable.slice(
            offset,
            offset + STATUS_BATCH
          );


        const response =
          await fetch(
            "/api/chain/key-images-spent",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json"
              },

              body:
                JSON.stringify({
                  key_images:
                    outputs.map(
                      output =>
                        output.keyImage
                    )
                })
            }
          );


        let data = null;

        try {
          data =
            await response.json();
        }
        catch {}


        if (!response.ok) {

          throw new Error(
            data?.error ||
            "Unable to check output spent status"
          );
        }


        if (
          !Array.isArray(
            data.spent_status
          ) ||
          data.spent_status.length !==
            outputs.length
        ) {

          throw new Error(
            "Invalid spent-status response"
          );
        }


        for (
          let i = 0;
          i < outputs.length;
          ++i
        ) {

          const output =
            outputs[i];

          const status =
            Number(
              data.spent_status[i]
            );


          output.spentStatus =
            status;

          output.spent =
            status !== 0;

          output.spentInPool =
            status === 2;


          /*
           * If the local scanner did not identify
           * the spending transaction, leave txid/
           * height unknown but still exclude the
           * output from balance and spending.
           */
          if (
            status === 0
          ) {

            output.spentHeight =
              null;

            output.spentTxid =
              null;

          }

        }

      }

    }


    const unspent =
      ownedOutputs.filter(
        output =>
          !output.spent
      );

    const balance =
      unspent.reduce(
        (sum, output) =>
          sum + output.amount,
        0n
      );

    for (const output of ownedOutputs) {
      output.unlocked =
        !output.spent &&
        isOutputUnlocked(
          output,
          chainHeight
        );
    }

    const unlockedOutputs =
      unspent.filter(
        output =>
          output.unlocked
      );

    const unlockedBalance =
      unlockedOutputs.reduce(
        (sum, output) =>
          sum + output.amount,
        0n
      );

    const received =
      ownedOutputs.reduce(
        (sum, output) =>
          sum + output.amount,
        0n
      );

    const history = [
      ...incoming,
      ...outgoing
    ].sort(
      (a, b) =>
        (b.height - a.height) ||
        (b.timestamp - a.timestamp)
    );

    return {
      chainHeight,
      scannedHeight,

      restoreHeight:
        restoreStart,

      scanStart:
        start,

      incremental,

      lastBlockHash,

      watchOnly:
        !keys.privateSpendKey,

      received,
      balance:
        keys.privateSpendKey
          ? balance
          : null,

      ownedOutputs,
      unspent,
      unlockedOutputs,
      unlockedBalance,
      incoming,
      outgoing,
      history,

      formatAtomic
    };
  }

  window.FeelcoinScanner = {
    scanWallet,
    parseTxExtra,
    formatAtomic
  };
})();
