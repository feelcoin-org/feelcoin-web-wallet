(() => {
  "use strict";

  const ATOMIC =
    1000000000000n;

  const MAX_SAFE_RANDOM =
    9007199254740992;

  const $ = id =>
    document.getElementById(id);


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


  function parseCoreResult(value) {

    if (
      typeof value === "string"
    ) {
      return JSON.parse(value);
    }

    return value;
  }


  function atomicString(value) {

    if (
      typeof value === "bigint"
    ) {
      return value.toString();
    }

    if (
      typeof value === "number"
    ) {

      if (
        !Number.isSafeInteger(value) ||
        value < 0
      ) {
        throw new Error(
          "Unsafe atomic amount"
        );
      }

      return String(value);
    }

    const text =
      String(value ?? "").trim();

    if (!/^\d+$/.test(text)) {
      throw new Error(
        "Invalid atomic amount"
      );
    }

    return text;
  }


  function parseFeel(value) {

    const text =
      String(value || "").trim();

    if (
      !/^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/
        .test(text)
    ) {
      throw new Error(
        "Enter a valid FEEL amount with at most 12 decimals"
      );
    }

    const [
      whole,
      fraction = ""
    ] =
      text.split(".");

    const amount =
      BigInt(whole) *
      ATOMIC +
      BigInt(
        fraction.padEnd(
          12,
          "0"
        )
      );

    if (amount <= 0n) {
      throw new Error(
        "Amount must be greater than zero"
      );
    }

    return amount;
  }


  function formatFeel(value) {

    return (
      window.FeelcoinScanner
        ?.formatAtomic
        ? FeelcoinScanner
            .formatAtomic(value)
        : (
            Number(
              BigInt(value)
            ) /
            1e12
          ).toString()
    );
  }


  async function api(
    url,
    options = {}
  ) {

    const response =
      await fetch(
        url,
        {
          credentials:
            "same-origin",

          cache:
            "no-store",

          ...options,

          headers: {
            "Content-Type":
              "application/json",

            ...(options.headers || {})
          }
        }
      );


    const text =
      await response.text();

    let data = {};

    try {
      data =
        text
          ? JSON.parse(text)
          : {};
    }
    catch {
      throw new Error(
        `Invalid response from ${url}`
      );
    }


    if (!response.ok) {

      throw new Error(
        data.error ||
        data.reason ||
        data.status ||
        `HTTP ${response.status}`
      );

    }

    return data;
  }


  /* =========================================================
     SECURE BROWSER RANDOMNESS
     ========================================================= */

  function randomUnit() {

    const words =
      new Uint32Array(2);

    crypto.getRandomValues(
      words
    );

    /*
     * 53 random bits that can be represented
     * exactly by JavaScript Number.
     */
    const high =
      words[0] &
      0x001fffff;

    const value =
      high *
      4294967296 +
      words[1];

    return (
      value /
      MAX_SAFE_RANDOM
    );
  }


  function randomInt(
    maxExclusive
  ) {

    if (
      !Number.isSafeInteger(
        maxExclusive
      ) ||
      maxExclusive <= 0
    ) {
      throw new Error(
        "Invalid random range"
      );
    }

    const limit =
      Math.floor(
        MAX_SAFE_RANDOM /
        maxExclusive
      ) *
      maxExclusive;

    while (true) {

      const value =
        Math.floor(
          randomUnit() *
          MAX_SAFE_RANDOM
        );

      if (value < limit) {
        return (
          value %
          maxExclusive
        );
      }

    }
  }


  function normalSample() {

    let u1 = 0;

    while (u1 <= 0) {
      u1 = randomUnit();
    }

    const u2 =
      randomUnit();

    return (
      Math.sqrt(
        -2 *
        Math.log(u1)
      ) *
      Math.cos(
        2 *
        Math.PI *
        u2
      )
    );
  }


  /*
   * Marsaglia-Tsang gamma sampler.
   *
   * Feelcoin follows the Monero-style
   * ring-member age distribution here.
   */
  function gammaSample(
    shape,
    scale
  ) {

    if (shape <= 1) {
      throw new Error(
        "Unsupported gamma shape"
      );
    }

    const d =
      shape -
      1 / 3;

    const c =
      1 /
      Math.sqrt(
        9 * d
      );


    while (true) {

      const x =
        normalSample();

      let v =
        1 +
        c * x;

      if (v <= 0) {
        continue;
      }

      v =
        v * v * v;

      const u =
        randomUnit();


      if (
        u <
        1 -
        0.0331 *
        x * x *
        x * x
      ) {
        return (
          scale *
          d *
          v
        );
      }


      if (
        Math.log(u) <
        0.5 *
        x * x +
        d *
        (
          1 -
          v +
          Math.log(v)
        )
      ) {
        return (
          scale *
          d *
          v
        );
      }

    }
  }


  function lowerBound(
    array,
    value,
    end
  ) {

    let left = 0;
    let right = end;

    while (
      left <
      right
    ) {

      const middle =
        Math.floor(
          (
            left +
            right
          ) /
          2
        );

      if (
        Number(
          array[middle]
        ) <
        value
      ) {
        left =
          middle + 1;
      }
      else {
        right =
          middle;
      }

    }

    return left;
  }


  /* =========================================================
     CLIENT-SIDE DECOY PICKER
     ========================================================= */

  function makeGammaPicker(
    distribution
  ) {

    const config =
      window.FEELCOIN_NETWORK || {};

    const targetSeconds =
      Number(
        config.targetSeconds ||
        120
      );

    const spendableAge =
      Math.max(
        1,
        Number(
          config.spendableAge ||
          10
        )
      );


    if (
      !Array.isArray(
        distribution
      ) ||
      distribution.length <
      spendableAge
    ) {
      throw new Error(
        "Output distribution is too small"
      );
    }


    for (
      const value of distribution
    ) {

      if (
        !Number.isSafeInteger(
          Number(value)
        )
      ) {
        throw new Error(
          "Output distribution exceeds safe browser integer range"
        );
      }

    }


    const GAMMA_SHAPE =
      19.28;

    const GAMMA_SCALE =
      1 / 1.61;


    const DEFAULT_UNLOCK_TIME =
      spendableAge *
      targetSeconds;


    const RECENT_SPEND_WINDOW =
      15 *
      targetSeconds;


    const blocksInYear =
      Math.floor(
        86400 *
        365 /
        targetSeconds
      );


    const blocksToConsider =
      Math.min(
        distribution.length,
        blocksInYear
      );


    const previous =
      blocksToConsider <
      distribution.length

        ? Number(
            distribution[
              distribution.length -
              blocksToConsider -
              1
            ]
          )

        : 0;


    const outputsToConsider =
      Number(
        distribution[
          distribution.length -
          1
        ]
      ) -
      previous;


    if (
      outputsToConsider <= 0
    ) {
      throw new Error(
        "No usable RingCT outputs"
      );
    }


    /*
     * Same exclusion of the newest locked blocks
     * as wallet2 gamma_picker.
     */
    const end =
      distribution.length -
      (
        spendableAge -
        1
      );


    if (end <= 0) {
      throw new Error(
        "No unlocked RingCT output range"
      );
    }


    const numRctOutputs =
      Number(
        distribution[
          end - 1
        ]
      );


    if (
      numRctOutputs <= 0
    ) {
      throw new Error(
        "No RingCT outputs available"
      );
    }


    const averageOutputTime =
      targetSeconds *
      blocksToConsider /
      outputsToConsider;


    return function pickDecoy() {

      for (
        let attempt = 0;
        attempt < 10000;
        ++attempt
      ) {

        let x =
          Math.exp(
            gammaSample(
              GAMMA_SHAPE,
              GAMMA_SCALE
            )
          );


        if (
          x >
          DEFAULT_UNLOCK_TIME
        ) {

          x -=
            DEFAULT_UNLOCK_TIME;

        }
        else {

          x =
            randomInt(
              RECENT_SPEND_WINDOW
            );

        }


        let outputIndex =
          Math.floor(
            x /
            averageOutputTime
          );


        if (
          outputIndex >=
          numRctOutputs
        ) {
          continue;
        }


        outputIndex =
          numRctOutputs -
          1 -
          outputIndex;


        const blockIndex =
          lowerBound(
            distribution,
            outputIndex,
            end
          );


        if (
          blockIndex >= end
        ) {
          continue;
        }


        const firstRct =
          blockIndex === 0

            ? 0

            : Number(
                distribution[
                  blockIndex -
                  1
                ]
              );


        const numberInBlock =
          Number(
            distribution[
              blockIndex
            ]
          ) -
          firstRct;


        if (
          numberInBlock <= 0
        ) {
          continue;
        }


        return (
          firstRct +
          randomInt(
            numberInBlock
          )
        );

      }


      throw new Error(
        "Unable to choose a decoy output"
      );
    };
  }


  async function fetchMixOutputs(
    indices
  ) {

    const all = [];

    /*
     * Keep requests comfortably below the
     * server's 512-output limit.
     */
    for (
      let offset = 0;
      offset < indices.length;
      offset += 256
    ) {

      const chunk =
        indices.slice(
          offset,
          offset + 256
        );


      const response =
        await api(
          "/api/chain/mix-outs",
          {
            method:
              "POST",

            body:
              JSON.stringify({
                indices:
                  chunk
              })
          }
        );


      if (
        !Array.isArray(
          response.outputs
        ) ||
        response.outputs.length !==
        chunk.length
      ) {
        throw new Error(
          "Daemon returned incomplete mix outputs"
        );
      }


      all.push(
        ...response.outputs
      );

    }


    return all;
  }


  async function buildMixOuts(
    usingOuts,
    mixin
  ) {

    const distributionReply =
      await api(
        "/api/chain/output-distribution"
      );


    const distribution =
      distributionReply
        .distribution;


    const picker =
      makeGammaPicker(
        distribution
      );


    /*
     * MyMonero wants mixin + 1 candidate
     * outputs per real input.
     *
     * Some daemon outputs may still be locked
     * or otherwise unusable, so keep sampling
     * until we have enough valid candidates.
     */
    const candidatesPerInput =
      Number(mixin) + 1;


    if (
      !Number.isSafeInteger(
        candidatesPerInput
      ) ||
      candidatesPerInput < 2 ||
      candidatesPerInput > 64
    ) {
      throw new Error(
        "Invalid ring size"
      );
    }


    const mixOuts = [];


    for (
      const unused of usingOuts
    ) {

      const outputs = [];
      const usedIndices =
        new Set();

      let attempts = 0;


      while (
        outputs.length <
        candidatesPerInput
      ) {

        if (
          ++attempts >
          500
        ) {
          throw new Error(
            "Unable to find enough unlocked decoys"
          );
        }


        const wanted = [];

        /*
         * Fetch a few spare candidates at once.
         * Locked/invalid ones are simply skipped.
         */
        while (
          wanted.length < 8 &&
          usedIndices.size < 100000
        ) {

          const index =
            picker();


          if (
            usedIndices.has(
              String(index)
            )
          ) {
            continue;
          }


          usedIndices.add(
            String(index)
          );

          wanted.push(index);
        }


        const fetched =
          await fetchMixOutputs(
            wanted
          );


        for (
          const output of fetched
        ) {

          if (
            outputs.length >=
            candidatesPerInput
          ) {
            break;
          }


          if (
            !output ||
            output.unlocked === false
          ) {
            continue;
          }


          if (
            !/^[0-9a-f]{64}$/i.test(
              String(
                output.public_key ||
                ""
              )
            )
          ) {
            continue;
          }


          if (
            !/^[0-9a-f]{64}$/i.test(
              String(
                output.rct ||
                ""
              )
            )
          ) {
            continue;
          }


          outputs.push({
            global_index:
              String(
                output.global_index
              ),

            public_key:
              output.public_key,

            rct:
              output.rct
          });
        }

      }


      mixOuts.push({
        amount:
          "0",

        outputs
      });

    }


    return mixOuts;
  }


  /* =========================================================
     SCANNER OUTPUT -> MYMONERO SPENDABLE OUTPUT
     ========================================================= */

  function makeSpendableOutput(
    output
  ) {

    const amount =
      pick(
        output,
        [
          "amount"
        ]
      );


    const publicKey =
      pick(
        output,
        [
          "outputPublicKey",
          "publicKey",
          "public_key",
          "key"
        ]
      );


    const globalIndex =
      pick(
        output,
        [
          "globalIndex",
          "global_index"
        ]
      );


    const index =
      pick(
        output,
        [
          "index",
          "outputIndex",
          "output_index"
        ]
      );


    const txPublicKey =
      pick(
        output,
        [
          "txPublicKey",
          "usedTxPublicKey",
          "tx_pub_key"
        ]
      );


    let rct =
      pick(
        output,
        [
          "rct"
        ]
      );


    if (
      !rct &&
      output.coinbase
    ) {
      rct =
        "coinbase";
    }


    if (!rct) {

      const commitment =
        pick(
          output,
          [
            "commitment",
            "outPk",
            "mask"
          ]
        );


      const encryptedAmount =
        pick(
          output,
          [
            "encryptedAmount",
            "encrypted_amount",
            "ecdhAmount"
          ]
        );


      if (
        commitment &&
        encryptedAmount
      ) {

        rct =
          String(commitment) +
          String(encryptedAmount);

      }

    }


    if (
      amount === null ||
      publicKey === null ||
      globalIndex === null ||
      index === null ||
      txPublicKey === null ||
      rct === null
    ) {
      return null;
    }


    return {
      amount:
        atomicString(
          amount
        ),

      public_key:
        String(
          publicKey
        ),

      index:
        String(
          index
        ),

      global_index:
        String(
          globalIndex
        ),

      rct:
        String(
          rct
        ),

      tx_pub_key:
        String(
          txPublicKey
        )
    };
  }


  function walletKeys(
    wallet
  ) {

    return {

      address:
        pick(
          wallet,
          [
            "address",
            "address_string"
          ]
        ),

      privateViewKey:
        pick(
          wallet,
          [
            "privateViewKey",
            "private_view_key",
            "sec_viewKey_string",
            "viewkey"
          ]
        ),

      privateSpendKey:
        pick(
          wallet,
          [
            "privateSpendKey",
            "private_spend_key",
            "sec_spendKey_string",
            "spendkey"
          ]
        )

    };
  }


  function getSpendableOutputs(
    scan
  ) {

    let outputs = [];


    if (
      Array.isArray(
        scan?.unlockedOutputs
      )
    ) {

      outputs =
        scan.unlockedOutputs;

    }
    else if (
      Array.isArray(
        scan?.unspent
      )
    ) {

      outputs =
        scan.unspent.filter(
          output =>
            output.unlocked === true
        );

    }


    return outputs
      .map(
        makeSpendableOutput
      )
      .filter(Boolean);
  }


  /* =========================================================
     NON-CUSTODIAL TRANSACTION
     ========================================================= */

  async function sendFeel() {

    const runtime =
      window.FeelcoinWalletRuntime;

    const dashboard =
      window.FeelcoinDashboard;


    if (
      !runtime ||
      !dashboard
    ) {
      throw new Error(
        "Wallet runtime is not ready"
      );
    }


    const core =
      runtime.getCore();

    const wallet =
      runtime.getWallet();


    if (
      !core ||
      !wallet
    ) {
      throw new Error(
        "Open your wallet first"
      );
    }


    if (
      typeof core
        .send_step1__prepare_params_for_get_decoys
        !== "function" ||
      typeof core
        .send_step2__try_create_transaction
        !== "function"
    ) {
      throw new Error(
        "Browser transaction signer is not loaded"
      );
    }


    const keys =
      walletKeys(
        wallet
      );


    if (
      !keys.address ||
      !keys.privateViewKey ||
      !keys.privateSpendKey
    ) {
      throw new Error(
        "View-only wallets cannot send FEEL"
      );
    }


    const destination =
      String(
        $("sendAddress")
          ?.value ||
        ""
      ).trim();


    const amount =
      parseFeel(
        $("sendAmount")
          ?.value
      );


    let decoded;


    try {

      decoded =
        parseCoreResult(
          core.decode_address(
            destination,
            "MAINNET"
          )
        );

    }
    catch {

      throw new Error(
        "Invalid Feelcoin destination address"
      );

    }


    if (
      decoded?.err_msg
    ) {
      throw new Error(
        decoded.err_msg
      );
    }


    const scan =
      dashboard
        .getLastResult();


    if (!scan) {
      throw new Error(
        "Refresh and synchronize the wallet before sending"
      );
    }


    const spendable =
      getSpendableOutputs(
        scan
      );


    if (
      spendable.length === 0
    ) {
      throw new Error(
        "No unlocked spendable outputs are available"
      );
    }


    const feeReply =
      await api(
        "/api/chain/fee"
      );


    const feePerByte =
      String(
        feeReply.fee ??
        feeReply.fees?.[0] ??
        ""
      );


    const feeMask =
      String(
        feeReply.quantization_mask ??
        ""
      );


    if (
      !/^\d+$/.test(
        feePerByte
      ) ||
      BigInt(feePerByte) <= 0n ||
      !/^\d+$/.test(
        feeMask
      ) ||
      BigInt(feeMask) <= 0n
    ) {
      throw new Error(
        "Invalid network fee data"
      );
    }


    const config =
      window.FEELCOIN_NETWORK ||
      {};


    const forkVersion =
      String(
        config.forkVersion ??
        16
      );


    const step1Args = {

      unspent_outs:
        spendable,

      sending_amount:
        amount.toString(),

      is_sweeping:
        false,

      priority:
        "1",

      fee_per_b:
        feePerByte,

      fee_mask:
        feeMask,

      fork_version:
        forkVersion
    };


    if (
      decoded?.paymentId
    ) {

      step1Args
        .payment_id_string =
          decoded.paymentId;

    }


    const step1 =
      parseCoreResult(
        core
          .send_step1__prepare_params_for_get_decoys(
            JSON.stringify(
              step1Args
            )
          )
      );


    if (
      step1?.err_msg
    ) {

      if (
        step1.spendable_balance &&
        step1.required_balance
      ) {

        throw new Error(
          `${step1.err_msg}. Spendable: ` +
          `${formatFeel(step1.spendable_balance)} FEEL, required: ` +
          `${formatFeel(step1.required_balance)} FEEL`
        );

      }


      throw new Error(
        step1.err_msg
      );
    }


    if (
      !Array.isArray(
        step1.using_outs
      ) ||
      step1.using_outs.length === 0
    ) {
      throw new Error(
        "Transaction builder selected no inputs"
      );
    }


    const mixin =
      Number(
        step1.mixin
      );


    const mixOuts =
      await buildMixOuts(
        step1.using_outs,
        mixin
      );


    /*
     * MyMonero requires the selected wallet inputs
     * to be tied to a fixed set of decoys before
     * transaction construction/signing.
     */
    if (
      typeof core
        .pre_step2_tie_unspent_outs_to_mix_outs_for_all_future_tx_attempts !==
      "function"
    ) {
      throw new Error(
        "Browser mix-output signer helper is not loaded"
      );
    }


    const tiedMixOuts =
      parseCoreResult(
        core
          .pre_step2_tie_unspent_outs_to_mix_outs_for_all_future_tx_attempts(
            JSON.stringify({
              using_outs:
                step1.using_outs,

              mix_outs:
                mixOuts
            })
          )
      );


    if (
      tiedMixOuts?.err_msg
    ) {
      throw new Error(
        tiedMixOuts.err_msg
      );
    }


    if (
      !Array.isArray(
        tiedMixOuts?.mix_outs
      ) ||
      tiedMixOuts.mix_outs.length !==
        step1.using_outs.length
    ) {
      throw new Error(
        "Transaction builder could not tie decoys to selected inputs"
      );
    }


    const fee =
      BigInt(
        step1.using_fee
      );


    const confirmed =
      confirm(
        `Send ${$("sendAmount").value} FEEL?\n\n` +
        `Network fee: ${formatFeel(fee)} FEEL\n` +
        `Ring size: ${mixin + 1}\n\n` +
        `Destination:\n${destination}\n\n` +
        `The transaction will be signed locally in this browser.\n\nLIVE MODE: the signed transaction will be broadcast to the Feelcoin network.`
      );


    if (!confirmed) {
      return;
    }


    const step2Args = {

      final_total_wo_fee:
        String(
          step1.final_total_wo_fee
        ),

      change_amount:
        String(
          step1.change_amount
        ),

      fee_amount:
        String(
          step1.using_fee
        ),

      using_outs:
        step1.using_outs,

      mix_outs:
        tiedMixOuts.mix_outs,

      payment_id_string:
        decoded?.paymentId ||
        undefined,

      nettype_string:
        "MAINNET",

      to_address_string:
        destination,

      from_address_string:
        keys.address,

      sec_viewKey_string:
        keys.privateViewKey,

      sec_spendKey_string:
        keys.privateSpendKey,

      fee_per_b:
        feePerByte,

      fee_mask:
        feeMask,

      fork_version:
        forkVersion,

      unlock_time:
        "0",

      priority:
        "1"
    };


    if (
      step2Args
        .payment_id_string ===
      undefined
    ) {
      delete step2Args
        .payment_id_string;
    }


    /*
     * IMPORTANT:
     *
     * Private keys are passed only to the
     * local WebAssembly signer here.
     * They are never included in fetch().
     */
    const signed =
      parseCoreResult(
        core
          .send_step2__try_create_transaction(
            JSON.stringify(
              step2Args
            )
          )
      );


    if (
      signed?.err_msg
    ) {
      throw new Error(
        signed.err_msg
      );
    }


    if (
      signed
        ?.tx_must_be_reconstructed ===
      true ||
      signed
        ?.tx_must_be_reconstructed ===
      "true"
    ) {
      throw new Error(
        "Transaction requires fee reconstruction. It was NOT broadcast."
      );
    }


    const txHex =
      signed
        ?.serialized_signed_tx;


    if (
      !txHex ||
      !/^[0-9a-f]+$/i.test(
        txHex
      )
    ) {
      throw new Error(
        "Local signer returned no valid signed transaction"
      );
    }


    /*
     * This is the ONLY transaction material
     * sent to the VPS: the already-signed blob.
     */
    /*
     * VALIDATION-ONLY MODE.
     *
     * The signed blob is sent ONLY to the
     * isolated offline validator.
     *
     * There is deliberately NO production
     * broadcast call in this code path.
     */
    /*
     * LIVE MODE.
     *
     * Transaction construction and signing have
     * already happened locally in the browser.
     *
     * Only the serialized signed transaction is
     * submitted to the server.
     */
    const broadcast =
      await api(
        "/api/chain/broadcast-live",
        {
          method:
            "POST",

          body:
            JSON.stringify({
              tx_as_hex:
                txHex
            })
        }
      );


    if (
      broadcast.broadcasted !== true ||
      (
        broadcast.status &&
        broadcast.status !== "OK"
      )
    ) {
      throw new Error(
        broadcast.reason ||
        broadcast.error ||
        broadcast.status ||
        "Feelcoin daemon rejected transaction"
      );
    }


    if (
      $("sendMessage")
    ) {

      $("sendMessage")
        .style.color =
          "var(--green)";

      $("sendMessage")
        .textContent =
          "Transaction broadcast: " +
          signed.tx_hash;

    }


    if (
      $("sendAddress")
    ) {
      $("sendAddress")
        .value = "";
    }


    if (
      $("sendAmount")
    ) {
      $("sendAmount")
        .value = "";
    }


    return {
      tx_hash:
        signed.tx_hash,

      broadcasted:
        true
    };
  }


  /* =========================================================
     SAFE PREFLIGHT — PRINTS NO PRIVATE KEYS
     ========================================================= */

  function preflight() {

    const runtime =
      window.FeelcoinWalletRuntime;

    const core =
      runtime?.getCore?.();

    const wallet =
      runtime?.getWallet?.();

    const scan =
      window
        .FeelcoinDashboard
        ?.getLastResult?.();


    const keys =
      wallet
        ? walletKeys(wallet)
        : {};


    const spendable =
      scan
        ? getSpendableOutputs(
            scan
          )
        : [];


    return {

      walletOpen:
        !!wallet,

      fullWallet:
        !!keys.privateSpendKey,

      scannerReady:
        !!scan,

      spendableOutputs:
        spendable.length,

      step1Signer:
        typeof core
          ?.send_step1__prepare_params_for_get_decoys ===
        "function",

      tieSigner:
        typeof core
          ?.pre_step2_tie_unspent_outs_to_mix_outs_for_all_future_tx_attempts ===
        "function",

      step2Signer:
        typeof core
          ?.send_step2__try_create_transaction ===
        "function",

      broadcastEndpoint:
        "/api/chain/broadcast-live",

      privateKeysSentToServer:
        false
    };
  }


  function install() {

    const button =
      $("sendButton");


    if (!button) {
      return;
    }


    button.onclick =
      async () => {

        button.disabled =
          true;


        if (
          $("sendMessage")
        ) {

          $("sendMessage")
            .style.color =
              "";

          $("sendMessage")
            .textContent =
              "Building transaction locally…";

        }


        try {

          await sendFeel();

        }
        catch(error) {

          console.error(
            "Send FEEL failed:",
            error
          );


          if (
            $("sendMessage")
          ) {

            $("sendMessage")
              .style.color =
                "var(--red)";

            $("sendMessage")
              .textContent =
                error.message;

          }

        }
        finally {

          updateButton();

        }

      };


    updateButton();
  }


  function updateButton() {

    const button =
      $("sendButton");


    if (!button) {
      return;
    }


    const wallet =
      window
        .FeelcoinWalletRuntime
        ?.getWallet?.();


    const keys =
      wallet
        ? walletKeys(wallet)
        : {};


    button.disabled =
      !wallet ||
      !keys.privateSpendKey;


    if (
      wallet &&
      keys.privateSpendKey &&
      $("sendMessage") &&
      $("sendMessage")
        .textContent
        .includes(
          "not enabled"
        )
    ) {

      $("sendMessage")
        .style.color =
          "";

      $("sendMessage")
        .textContent =
          "Client-side transaction signing ready.";

    }
  }


  window.FeelcoinSend = {
    sendFeel,
    preflight
  };


  install();


  setInterval(
    updateButton,
    750
  );

})();
