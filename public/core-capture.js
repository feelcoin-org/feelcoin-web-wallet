(() => {
  "use strict";

  const original =
    window.MyMoneroClient;

  if (typeof original !== "function") {
    console.error(
      "Feelcoin: MyMoneroClient was not loaded"
    );
    return;
  }

  window.MyMoneroClient =
    function(...args) {

      const result =
        original.apply(
          this,
          args
        );

      Promise.resolve(result)
        .then(core => {

          window.__feelcoinCore =
            core;

          console.log(
            "Feelcoin WASM core captured."
          );

        })
        .catch(error => {

          console.error(
            "Feelcoin WASM initialization failed:",
            error
          );

        });

      return result;
    };

})();
