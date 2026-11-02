(function () {
  const READY_TIMEOUT_MS = 6000; // if it isn't ready by then, give up and use the normal upload
  const FINAL_TIMEOUT_MS = 9000; // how long to wait for the finished transcript after "Done"

  function open({ onReady, onPartial, onFailed } = {}) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let socket;
    try {
      socket = new WebSocket(`${protocol}//${window.location.host}/ws/live`);
    } catch (error) {
      if (onFailed) onFailed();
      return { send() {}, finish: async () => null, close() {} };
    }
    socket.binaryType = "arraybuffer";

    let ready = false;
    let failed = false;
    let finishing = false;
    let lastText = "";
    let finalText = null;
    let queue = []; // audio recorded before the connection was ready
    let waiting = null; // set while finish() is waiting for the final transcript

    function fail() {
      if (failed) return;
      failed = true;
      queue = [];
      if (!ready && onFailed) onFailed();
      if (waiting) waiting();
    }

    const readyTimer = setTimeout(() => {
      if (!ready) {
        fail();
        try {
          socket.close();
        } catch (error) {}
      }
    }, READY_TIMEOUT_MS);

    socket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        return;
      }

      if (message.type === "ready") {
        ready = true;
        clearTimeout(readyTimer);
        queue.forEach((frame) => socket.send(frame.buffer));
        queue = [];
        if (onReady) onReady();
      } else if (message.type === "partial") {
        lastText = message.text || "";
        if (onPartial) onPartial(lastText);
      } else if (message.type === "final") {
        finalText = message.text || "";
        if (onPartial && finalText) onPartial(finalText);
        if (waiting) waiting();
      } else if (message.type === "error") {
        fail();
      }
    };
    socket.onerror = fail;
    socket.onclose = () => {
      clearTimeout(readyTimer);
      if (!ready) fail();
      if (waiting) waiting();
    };

    return {
      send(frame) {
        if (failed || finishing) return;
        if (ready && socket.readyState === WebSocket.OPEN) socket.send(frame.buffer);
        else queue.push(frame);
      },

      // tell Meta there's no more audio, then wait for the finished transcript
      async finish() {
        if (failed || !ready) {
          this.close();
          return null;
        }
        finishing = true;
        const done = new Promise((resolve) => {
          waiting = resolve;
          setTimeout(resolve, FINAL_TIMEOUT_MS);
        });
        try {
          socket.send(JSON.stringify({ type: "end" }));
        } catch (error) {
          return null;
        }
        await done;
        waiting = null;
        this.close();
        // the finished transcript, or the last words we saw if it never arrived
        return finalText !== null ? finalText : lastText || null;
      },

      close() {
        clearTimeout(readyTimer);
        try {
          socket.close();
        } catch (error) {}
      },
    };
  }

  window.UnpileLive = { open };
})();