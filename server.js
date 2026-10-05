import express from "express";
import helmet from "helmet";

const app = express();

app.disable("x-powered-by");

const PORT = 8084;
const HOST = "127.0.0.1";

const DAEMON = "http://127.0.0.1:35781";

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);


/* FEELCOIN PRODUCTION HARDENING v1 */

app.disable("x-powered-by");


/*
 * Browser-wallet CSP.
 *
 * unsafe-eval is retained only for compatibility with
 * the current Emscripten/MyMonero WASM runtime.
 *
 * All application resources remain same-origin.
 */
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: [
        "'self'"
      ],

      scriptSrc: [
        "'self'",
        "'unsafe-eval'"
      ],

      styleSrc: [
        "'self'",
        "'unsafe-inline'"
      ],

      imgSrc: [
        "'self'",
        "data:",
        "blob:"
      ],

      connectSrc: [
        "'self'"
      ],

      fontSrc: [
        "'self'",
        "data:"
      ],

      workerSrc: [
        "'self'",
        "blob:"
      ],

      objectSrc: [
        "'none'"
      ],

      baseUri: [
        "'self'"
      ],

      frameAncestors: [
        "'none'"
      ],

      formAction: [
        "'self'"
      ]
    }
  })
);


/*
 * Additional browser security headers.
 */
app.use((req, res, next) => {

  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()"
  );

  res.setHeader(
    "X-Frame-Options",
    "DENY"
  );

  next();
});


/*
 * Accepted browser origins for state-changing API calls.
 *
 * localhost remains available for local development/testing.
 */
const FEELCOIN_ALLOWED_ORIGINS =
  new Set(
    String(
      process.env.FEELCOIN_ALLOWED_ORIGINS ||
      "https://wallet.feelcoin.online,https://wallet.feelcoin.org,http://127.0.0.1:8084,http://localhost:8084"
    )
      .split(",")
      .map(value => value.trim())
      .filter(Boolean)
  );


/*
 * Lightweight in-memory API rate limiting.
 *
 * Full wallet scanning remains intentionally generous.
 * Live transaction relay receives the stricter limit.
 */
const feelcoinApiBuckets =
  new Map();


function feelcoinApiRateLimit(
  req,
  res,
  next
) {

  const now =
    Date.now();

  const windowMs =
    60 * 1000;

  const broadcast =
    String(req.originalUrl || "")
      .startsWith(
        "/api/chain/broadcast-live"
      );

  const limit =
    broadcast
      ? 30
      : 3000;

  const ip =
    String(
      req.ip ||
      req.socket?.remoteAddress ||
      "unknown"
    );

  const tier =
    broadcast
      ? "broadcast"
      : "general";

  const key =
    `${tier}:${ip}`;

  let state =
    feelcoinApiBuckets.get(key);

  if (
    !state ||
    now - state.started >= windowMs
  ) {

    state = {
      started: now,
      count: 0
    };

  }

  state.count += 1;

  feelcoinApiBuckets.set(
    key,
    state
  );

  if (
    state.count > limit
  ) {

    res.setHeader(
      "Retry-After",
      "60"
    );

    return res
      .status(429)
      .json({
        error:
          "Too many requests"
      });

  }

  next();
}


setInterval(
  () => {

    const cutoff =
      Date.now() -
      (5 * 60 * 1000);

    for (
      const [key, value]
      of feelcoinApiBuckets
    ) {

      if (
        value.started < cutoff
      ) {
        feelcoinApiBuckets
          .delete(key);
      }

    }

  },
  5 * 60 * 1000
).unref();


/*
 * General API protection.
 */
app.use(
  "/api",
  (req, res, next) => {

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    res.setHeader(
      "Pragma",
      "no-cache"
    );


    if (
      ![
        "GET",
        "HEAD",
        "POST",
        "OPTIONS"
      ].includes(req.method)
    ) {

      return res
        .status(405)
        .json({
          error:
            "Method not allowed"
        });

    }


    /*
     * Fetch Metadata protection.
     */
    const fetchSite =
      String(
        req.get(
          "Sec-Fetch-Site"
        ) || ""
      ).toLowerCase();

    if (
      fetchSite ===
      "cross-site"
    ) {

      return res
        .status(403)
        .json({
          error:
            "Cross-site request rejected"
        });

    }


    /*
     * Origin protection for state-changing browser calls.
     *
     * Requests without Origin are still accepted so local
     * administrative curl checks continue to work.
     */
    if (
      ![
        "GET",
        "HEAD",
        "OPTIONS"
      ].includes(req.method)
    ) {

      const origin =
        req.get("Origin");

      if (
        origin &&
        !FEELCOIN_ALLOWED_ORIGINS
          .has(origin)
      ) {

        return res
          .status(403)
          .json({
            error:
              "Origin not allowed"
          });

      }

    }


    /*
     * Explicitly retire the old broadcast endpoint.
     */
    if (
      String(
        req.originalUrl || ""
      )
        .split("?")[0] ===
        "/api/chain/broadcast"
    ) {

      return res
        .status(410)
        .json({
          error:
            "Legacy broadcast endpoint disabled"
        });

    }


    feelcoinApiRateLimit(
      req,
      res,
      next
    );

  }
);


/*
 * Server-side wallet operations are permanently disabled
 * for the non-custodial browser wallet.
 */
app.use(
  "/api/wallet",
  (req, res) => {

    return res
      .status(410)
      .json({
        error:
          "Legacy server-side wallet API disabled"
      });

  }
);


/* END FEELCOIN PRODUCTION HARDENING v1 */


app.use(
  express.json({
    limit: "2mb"
  })
);


/* FEELCOIN SIGNED TX BOUNDS v1 */

app.use(
  [
    "/api/chain/broadcast-live",
    "/api/chain/validate"
  ],
  (req, res, next) => {

    if (
      req.method !== "POST"
    ) {
      return next();
    }

    const tx =
      String(
        req.body?.tx_as_hex ||
        ""
      ).trim();


    /*
     * The global JSON body limit provides the primary
     * request-size boundary. This adds transaction-specific
     * validation before the blob reaches a daemon.
     */
    if (
      tx.length < 20 ||
      tx.length > 95000 ||
      tx.length % 2 !== 0 ||
      !/^[0-9a-f]+$/i.test(tx)
    ) {

      return res
        .status(400)
        .json({
          error:
            "Invalid serialized transaction"
        });

    }

    next();

  }
);

/* END FEELCOIN SIGNED TX BOUNDS v1 */


app.use(express.static("public"));

/* =========================================================
   HEALTH
   Public backend contains NO wallet state.
   ========================================================= */

app.get("/api/health", async (req, res) => {

  try {

    const response = await fetch(
      `${DAEMON}/json_rpc`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "0",
          method: "get_info"
        })
      }
    );

    const data = await response.json();

    res.json({
      status: "ok",
      daemon:
        data?.result?.status === "OK",
      height:
        data?.result?.height ?? 0,

      wallet_storage: false,
      wallet_rpc: false,
      private_keys_server_side: false
    });

  }
  catch (error) {

    res.status(503).json({
      status: "error",
      error: "Feelcoin daemon unavailable"
    });

  }

});


/* =========================================================
   DAEMON JSON-RPC PROXY

   Only blockchain/node operations.
   NO wallet-rpc methods.
   NO private keys.
   ========================================================= */

const ALLOWED_RPC_METHODS = new Set([
  "get_info",
  "get_block_count",
  "get_block_header_by_height",
  "get_block_header_by_hash",
  "get_last_block_header",
  "get_fee_estimate"
]);

app.post("/api/node/json_rpc", async (req, res) => {

  try {

    const method =
      String(req.body?.method || "");

    if (!ALLOWED_RPC_METHODS.has(method)) {

      return res.status(403).json({
        error: "RPC method not permitted"
      });

    }

    const response = await fetch(
      `${DAEMON}/json_rpc`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          jsonrpc: "2.0",
          id: req.body?.id ?? "0",
          method,
          params: req.body?.params || {}
        })
      }
    );

    const data = await response.json();

    res.status(response.status).json(data);

  }
  catch {

    res.status(502).json({
      error: "Node RPC unavailable"
    });

  }

});


/* =========================================================
   RAW DAEMON ENDPOINTS

   We will add ONLY the specific methods needed by the
   client-side Feelcoin wallet as we implement them.
   ========================================================= */

app.post("/api/node/:method", async (req, res) => {

  const allowed = new Set([
    "get_height"
  ]);

  const method =
    String(req.params.method || "");

  if (!allowed.has(method)) {

    return res.status(403).json({
      error: "Daemon method not permitted"
    });

  }

  try {

    const response = await fetch(
      `${DAEMON}/${method}`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify(
          req.body || {}
        )
      }
    );

    const data = await response.json();

    res.status(response.status).json(data);

  }
  catch {

    res.status(502).json({
      error: "Node RPC unavailable"
    });

  }

});




/* =========================================================
   PUBLIC BLOCKCHAIN DATA API
   No wallet keys, seeds or private data accepted here.
   ========================================================= */

async function daemonJsonRpc(method, params = {}) {
  const response = await fetch(
    `${DAEMON}/json_rpc`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "0",
        method,
        params
      })
    }
  );

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(
      data?.error?.message ||
      `Daemon RPC ${method} failed`
    );
  }

  return data.result;
}


/* ---------- BLOCK BY HEIGHT ---------- */

app.get(
  "/api/chain/block/:height",
  async (req, res) => {

    try {
      const height =
        Number(req.params.height);

      if (
        !Number.isSafeInteger(height) ||
        height < 0
      ) {
        return res.status(400).json({
          error: "Invalid block height"
        });
      }

      const result =
        await daemonJsonRpc(
          "get_block",
          { height }
        );

      res.json(result);
    }
    catch (error) {
      res.status(502).json({
        error: error.message
      });
    }
  }
);


/* ---------- TRANSACTIONS ---------- */

app.post(
  "/api/chain/transactions",
  async (req, res) => {

    try {
      const hashes =
        req.body?.txs_hashes;

      if (
        !Array.isArray(hashes) ||
        hashes.length > 100
      ) {
        return res.status(400).json({
          error:
            "txs_hashes must be an array of at most 100 hashes"
        });
      }

      for (const hash of hashes) {
        if (
          typeof hash !== "string" ||
          !/^[0-9a-fA-F]{64}$/.test(hash)
        ) {
          return res.status(400).json({
            error: "Invalid transaction hash"
          });
        }
      }

      const response =
        await fetch(
          `${DAEMON}/get_transactions`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              txs_hashes: hashes,
              decode_as_json: true,
              prune: false
            })
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          "Daemon get_transactions failed"
        );
      }

      res.json(data);
    }
    catch (error) {
      res.status(502).json({
        error: error.message
      });
    }
  }
);


/* ---------- PUBLIC OUTPUT DATA ---------- */

app.post(
  "/api/chain/outs",
  async (req, res) => {

    try {
      const outputs =
        req.body?.outputs;

      if (
        !Array.isArray(outputs) ||
        outputs.length > 128
      ) {
        return res.status(400).json({
          error:
            "outputs must be an array of at most 128 entries"
        });
      }

      const cleaned = [];

      for (const out of outputs) {

        const amount =
          Number(out?.amount);

        const index =
          Number(out?.index);

        if (
          !Number.isSafeInteger(amount) ||
          amount < 0 ||
          !Number.isSafeInteger(index) ||
          index < 0
        ) {
          return res.status(400).json({
            error: "Invalid output request"
          });
        }

        cleaned.push({
          amount,
          index
        });
      }

      const response =
        await fetch(
          `${DAEMON}/get_outs`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              outputs: cleaned,
              get_txid: true
            })
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          "Daemon get_outs failed"
        );
      }

      res.json(data);
    }
    catch (error) {
      res.status(502).json({
        error: error.message
      });
    }
  }
);




/* =========================================================
   BATCH PUBLIC BLOCK RETRIEVAL

   Used by the browser-side wallet scanner.
   Public blockchain data only.
   ========================================================= */

app.get(
  "/api/chain/blocks",
  async (req, res) => {

    try {

      const start =
        Number(req.query.start);

      const count =
        Number(req.query.count ?? 50);


      if (
        !Number.isSafeInteger(start) ||
        start < 0
      ) {
        return res.status(400).json({
          error: "Invalid start height"
        });
      }


      if (
        !Number.isSafeInteger(count) ||
        count < 1 ||
        count > 100
      ) {
        return res.status(400).json({
          error:
            "count must be between 1 and 100"
        });
      }


      const heights =
        Array.from(
          { length: count },
          (_, i) => start + i
        );


      /*
       * Fetch sequentially.
       *
       * Do not hit feelcoind with 50 simultaneous
       * get_block RPC requests. On the current VPS
       * that can exhaust/close local RPC connections.
       */
      const blocks = [];

      for (const height of heights) {

        const block =
          await daemonJsonRpc(
            "get_block",
            { height }
          );

        blocks.push(block);
      }


      res.json({
        start,
        count: blocks.length,
        blocks
      });

    }
    catch(error) {

      res.status(502).json({
        error: error.message
      });

    }

  }
);




/* =========================================================
   NON-CUSTODIAL SEND SUPPORT

   Public blockchain data only:
   - fee estimate
   - RingCT output distribution
   - output lookup for browser-selected decoys
   - signed transaction broadcast

   No wallet seed/private key is accepted here.
   ========================================================= */


/* ---------- Fee estimate ---------- */

app.get(
  "/api/chain/fee",
  async (req, res) => {

    try {

      const result =
        await daemonJsonRpc(
          "get_fee_estimate",
          {
            grace_blocks: 10
          }
        );

      res.json(result);

    }
    catch(error) {

      res.status(502).json({
        error: error.message
      });

    }

  }
);


/* ---------- RingCT output distribution ---------- */

app.get(
  "/api/chain/output-distribution",
  async (req, res) => {

    try {

      const result =
        await daemonJsonRpc(
          "get_output_distribution",
          {
            amounts: [0],
            from_height: 0,
            cumulative: true,
            binary: false
          }
        );

      const distribution =
        result?.distributions?.[0];

      if (
        !distribution ||
        !Array.isArray(
          distribution.distribution
        )
      ) {
        throw new Error(
          "Daemon returned no RingCT output distribution"
        );
      }

      res.json({
        amount: 0,
        start_height:
          distribution.start_height ?? 0,
        base:
          distribution.base ?? 0,
        distribution:
          distribution.distribution
      });

    }
    catch(error) {

      res.status(502).json({
        error: error.message
      });

    }

  }
);


/* ---------- Public output lookup ---------- */

app.post(
  "/api/chain/mix-outs",
  async (req, res) => {

    try {

      const indices =
        req.body?.indices;

      if (
        !Array.isArray(indices) ||
        indices.length < 1 ||
        indices.length > 512
      ) {
        return res
          .status(400)
          .json({
            error:
              "indices must contain 1 to 512 output indices"
          });
      }

      const outputs =
        indices.map(index => {

          /*
           * Current Feelcoin chain is tiny, therefore
           * indices are safely below JS integer limits.
           * Keep this validation before sending to daemon.
           */

          const n =
            Number(index);

          if (
            !Number.isSafeInteger(n) ||
            n < 0
          ) {
            throw new Error(
              "Invalid output index"
            );
          }

          return {
            amount: 0,
            index: n
          };

        });


      const response =
        await fetch(
          `${DAEMON}/get_outs`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body:
              JSON.stringify({
                outputs,
                get_txid: true
              })
          }
        );


      const data =
        await response.json();


      if (!response.ok) {
        throw new Error(
          data?.error ||
          `Daemon HTTP ${response.status}`
        );
      }


      if (!Array.isArray(data.outs)) {
        throw new Error(
          "Daemon returned no outputs"
        );
      }


      const result =
        data.outs.map(
          (out, i) => ({
            global_index:
              String(indices[i]),

            public_key:
              out.key,

            rct:
              out.mask,

            txid:
              out.txid || null,

            unlocked:
              out.unlocked !== false
          })
        );


      res.json({
        outputs: result
      });

    }
    catch(error) {

      res.status(502).json({
        error: error.message
      });

    }

  }
);



/* =========================================================
   ISOLATED OFFLINE TRANSACTION VALIDATOR

   This daemon:
   - uses a disposable blockchain copy
   - listens only on 127.0.0.1:35881
   - runs with --offline
   - has no P2P connections

   It is NEVER used for production broadcast.
   ========================================================= */

const VALIDATOR_DAEMON =
  "http://127.0.0.1:35881";


async function validatorJsonRpc(
  method,
  params = {}
) {

  const response =
    await fetch(
      `${VALIDATOR_DAEMON}/json_rpc`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            jsonrpc: "2.0",
            id: "0",
            method,
            params
          })
      }
    );


  const data =
    await response.json();


  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      data?.error ||
      `Validator HTTP ${response.status}`
    );
  }


  if (data?.error) {
    throw new Error(
      data.error.message ||
      "Validator JSON-RPC error"
    );
  }


  return data.result;
}


/* ---------- Validator health ---------- */

app.get(
  "/api/validator/health",
  async (req, res) => {

    try {

      const response =
        await fetch(
          `${VALIDATOR_DAEMON}/get_height`
        );


      const data =
        await response.json();


      if (!response.ok) {
        throw new Error(
          `Validator HTTP ${response.status}`
        );
      }


      res.json({
        status: "ok",
        isolated: true,
        validator:
          "127.0.0.1:35881",

        height:
          Number(data.height || 0),

        hash:
          data.hash || null
      });

    }
    catch(error) {

      res.status(502).json({
        error:
          error.message
      });

    }

  }
);


/* ---------- Validator fee ---------- */

app.get(
  "/api/validator/fee",
  async (req, res) => {

    try {

      const result =
        await validatorJsonRpc(
          "get_fee_estimate",
          {
            grace_blocks: 10
          }
        );


      res.json(result);

    }
    catch(error) {

      res.status(502).json({
        error:
          error.message
      });

    }

  }
);


/* ---------- Validator RingCT distribution ---------- */

app.get(
  "/api/validator/output-distribution",
  async (req, res) => {

    try {

      const result =
        await validatorJsonRpc(
          "get_output_distribution",
          {
            amounts: [0],
            from_height: 0,
            to_height: 0,
            cumulative: true,
            binary: false
          }
        );


      const distribution =
        result?.distributions?.[0];


      if (
        !distribution ||
        !Array.isArray(
          distribution.distribution
        )
      ) {
        throw new Error(
          "Validator returned no RingCT output distribution"
        );
      }


      res.json({
        start_height:
          distribution.start_height,

        base:
          distribution.base,

        distribution:
          distribution.distribution
      });

    }
    catch(error) {

      res.status(502).json({
        error:
          error.message
      });

    }

  }
);


/* ---------- Validator decoy output lookup ---------- */

app.post(
  "/api/validator/mix-outs",
  async (req, res) => {

    try {

      const indices =
        req.body?.indices;


      if (
        !Array.isArray(indices) ||
        indices.length < 1 ||
        indices.length > 512 ||
        indices.some(
          index =>
            !Number.isSafeInteger(
              Number(index)
            ) ||
            Number(index) < 0
        )
      ) {

        return res
          .status(400)
          .json({
            error:
              "Invalid output indices"
          });
      }


      const normalized =
        indices.map(
          index =>
            Number(index)
        );


      const response =
        await fetch(
          `${VALIDATOR_DAEMON}/get_outs`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                outputs:
                  normalized.map(
                    index => ({
                      amount: 0,
                      index
                    })
                  ),

                get_txid: true
              })
          }
        );


      const data =
        await response.json();


      if (!response.ok) {
        throw new Error(
          data?.error ||
          `Validator HTTP ${response.status}`
        );
      }


      if (
        !Array.isArray(data.outs) ||
        data.outs.length !==
          normalized.length
      ) {
        throw new Error(
          "Validator returned incomplete outputs"
        );
      }


      res.json({
        outputs:
          data.outs.map(
            (out, i) => ({
              global_index:
                String(
                  normalized[i]
                ),

              public_key:
                out.key,

              rct:
                out.mask,

              txid:
                out.txid || null,

              unlocked:
                out.unlocked !== false
            })
          )
      });

    }
    catch(error) {

      res.status(502).json({
        error:
          error.message
      });

    }

  }
);


/* ---------- Isolated signed transaction validation ---------- */

app.post(
  "/api/chain/validate",
  async (req, res) => {

    try {

      const tx =
        String(
          req.body?.tx_as_hex ||
          ""
        ).trim();


      if (
        !/^[0-9a-f]+$/i.test(tx) ||
        tx.length % 2 !== 0 ||
        tx.length < 20 ||
        tx.length > 2000000
      ) {

        return res
          .status(400)
          .json({
            error:
              "Invalid signed transaction blob"
          });
      }


      /*
       * IMPORTANT:
       *
       * This request goes ONLY to the disposable
       * offline validator daemon.
       *
       * do_not_relay is also enabled.
       */

      const response =
        await fetch(
          `${VALIDATOR_DAEMON}/send_raw_transaction`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                tx_as_hex: tx,
                do_not_relay: true
              })
          }
        );


      const data =
        await response.json();


      if (!response.ok) {
        throw new Error(
          data?.error ||
          `Validator HTTP ${response.status}`
        );
      }


      if (
        data.status &&
        data.status !== "OK"
      ) {

        return res
          .status(400)
          .json({
            validated: false,
            isolated: true,
            ...data
          });
      }


      res.json({
        validated: true,
        isolated: true,
        ...data
      });

    }
    catch(error) {

      res.status(502).json({
        error:
          error.message
      });

    }

  }
);



/* =========================================================
   TEST SAFETY GUARD

   Production broadcasting is deliberately disabled while
   the browser signer is being tested against the isolated
   offline validator.
   ========================================================= */

app.post(
  "/api/chain/broadcast",
  (req, res) => {

    return res
      .status(503)
      .json({
        error:
          "Production broadcast disabled during isolated validation testing"
      });

  }
);



/* =========================================================
   KEY IMAGE SPENT STATUS

   Receives derived key images only.
   No wallet seed or private key is accepted.
   ========================================================= */

app.post(
  "/api/chain/key-images-spent",
  async (req, res) => {

    try {

      const keyImages =
        req.body?.key_images;


      if (
        !Array.isArray(keyImages) ||
        keyImages.length < 1 ||
        keyImages.length > 500
      ) {

        return res
          .status(400)
          .json({
            error:
              "key_images must contain 1 to 500 entries"
          });
      }


      const normalized =
        keyImages.map(
          value =>
            String(value || "")
              .trim()
              .toLowerCase()
        );


      if (
        normalized.some(
          value =>
            !/^[0-9a-f]{64}$/.test(value)
        )
      ) {

        return res
          .status(400)
          .json({
            error:
              "Invalid key image"
          });
      }


      const response =
        await fetch(
          "http://127.0.0.1:35781/is_key_image_spent",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                key_images:
                  normalized
              })
          }
        );


      const data =
        await response.json();


      if (!response.ok) {

        return res
          .status(502)
          .json({
            error:
              `Daemon HTTP ${response.status}`
          });
      }


      if (
        !Array.isArray(
          data.spent_status
        ) ||
        data.spent_status.length !==
          normalized.length
      ) {

        return res
          .status(502)
          .json({
            error:
              "Daemon returned invalid spent status"
          });
      }


      return res.json({
        status:
          data.status || "OK",

        spent_status:
          data.spent_status
            .map(Number)
      });

    }
    catch(error) {

      return res
        .status(502)
        .json({
          error:
            error.message
        });
    }

  }
);


/* ---------- Signed transaction broadcast ---------- */

app.post(
  "/api/chain/broadcast",
  async (req, res) => {

    try {

      const tx =
        String(
          req.body?.tx_as_hex ||
          ""
        ).trim();


      /*
       * Server accepts ONLY an already-signed
       * transaction blob.
       */

      if (
        !/^[0-9a-f]+$/i.test(tx) ||
        tx.length % 2 !== 0 ||
        tx.length < 20 ||
        tx.length > 2000000
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid signed transaction blob"
          });
      }


      const response =
        await fetch(
          `${DAEMON}/send_raw_transaction`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body:
              JSON.stringify({
                tx_as_hex: tx,
                do_not_relay: false
              })
          }
        );


      const data =
        await response.json();


      if (!response.ok) {
        throw new Error(
          data?.error ||
          `Daemon HTTP ${response.status}`
        );
      }


      if (
        data.status &&
        data.status !== "OK"
      ) {
        return res
          .status(400)
          .json(data);
      }


      res.json(data);

    }
    catch(error) {

      res.status(502).json({
        error: error.message
      });

    }

  }
);



/* =========================================================
   LIVE NON-CUSTODIAL TRANSACTION BROADCAST

   Receives ONLY an already-signed transaction blob.
   No seed, private spend key or private view key is accepted.
   ========================================================= */

app.post(
  "/api/chain/broadcast-live",
  async (req, res) => {

    try {

      const tx =
        String(
          req.body?.tx_as_hex ||
          ""
        ).trim();


      if (
        !/^[0-9a-f]+$/i.test(tx) ||
        tx.length % 2 !== 0 ||
        tx.length < 20 ||
        tx.length > 2000000
      ) {

        return res
          .status(400)
          .json({
            broadcasted: false,
            error:
              "Invalid signed transaction blob"
          });
      }


      /*
       * Send the ALREADY SIGNED transaction
       * to the live Feelcoin daemon.
       */
      const response =
        await fetch(
          "http://127.0.0.1:35781/send_raw_transaction",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                tx_as_hex: tx,
                do_not_relay: false
              })
          }
        );


      const data =
        await response.json();


      if (!response.ok) {

        return res
          .status(502)
          .json({
            broadcasted: false,
            error:
              data?.error ||
              `Daemon HTTP ${response.status}`
          });
      }


      if (
        data.status &&
        data.status !== "OK"
      ) {

        return res
          .status(400)
          .json({
            broadcasted: false,
            ...data
          });
      }


      return res.json({
        broadcasted: true,
        ...data
      });

    }
    catch(error) {

      return res
        .status(502)
        .json({
          broadcasted: false,
          error:
            error.message
        });
    }

  }
);


app.listen(
  PORT,
  HOST,
  () => {

    console.log(
      `Feelcoin non-custodial wallet backend listening on http://${HOST}:${PORT}`
    );

    console.log(
      "Server-side wallet storage: DISABLED"
    );

    console.log(
      "Wallet RPC: DISABLED"
    );

  }
);
