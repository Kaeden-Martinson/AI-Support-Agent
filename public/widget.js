/*!
 * AI Support Agent widget — drop-in chat bubble.
 *
 *   <script src="https://your-server/widget.js" data-agent="my-project" defer></script>
 *
 * Optional attributes: data-server, data-title, data-color, data-position="left|right",
 * data-greeting, data-open="true". Or skip data-agent and call SupportAgent.init({...}) yourself.
 */
(function () {
  "use strict";
  if (window.SupportAgent && window.SupportAgent.__loaded) return;

  var script = document.currentScript;
  var STORE_PREFIX = "support-agent:";

  function storage(key, value) {
    try {
      if (value === undefined) return JSON.parse(sessionStorage.getItem(STORE_PREFIX + key) || "null");
      if (value === null) sessionStorage.removeItem(STORE_PREFIX + key);
      else sessionStorage.setItem(STORE_PREFIX + key, JSON.stringify(value));
    } catch (e) {
      return null;
    }
  }

  // --- tiny, safe Markdown renderer (escape first, then format) -----------------------------
  function esc(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function safeHref(url) {
    var u = url.replace(/&amp;/g, "&");
    if (/^(https?:\/\/|\/|#|mailto:)/i.test(u)) return esc(u);
    return null;
  }
  function inline(s) {
    var codes = [];
    s = s.replace(/`([^`]+)`/g, function (_, c) {
      codes.push("<code>" + c + "</code>");
      return "\u0000" + (codes.length - 1) + "\u0000";
    });
    s = s
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, text, url) {
        var href = safeHref(url);
        return href ? '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + text + "</a>" : text;
      })
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
    return s.replace(/\u0000(\d+)\u0000/g, function (_, i) {
      return codes[+i];
    });
  }
  function markdown(src) {
    var out = [];
    var parts = esc(src).split(/```/);
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        var code = parts[i].replace(/^[\w+-]*\n/, "");
        out.push('<pre><button class="copy" type="button">Copy</button><code>' + code.replace(/\n$/, "") + "</code></pre>");
        continue;
      }
      var blocks = parts[i].split(/\n{2,}/);
      for (var j = 0; j < blocks.length; j++) {
        var b = blocks[j].trim();
        if (!b) continue;
        var lines = b.split("\n");
        if (lines.every(function (l) { return /^\s*([-*]|\d+\.)\s+/.test(l); })) {
          var ordered = /^\s*\d+\./.test(lines[0]);
          out.push(
            (ordered ? "<ol>" : "<ul>") +
              lines.map(function (l) { return "<li>" + inline(l.replace(/^\s*([-*]|\d+\.)\s+/, "")) + "</li>"; }).join("") +
              (ordered ? "</ol>" : "</ul>")
          );
        } else if (/^#{1,6}\s/.test(b)) {
          out.push("<p><strong>" + inline(b.replace(/^#{1,6}\s+/, "")) + "</strong></p>");
        } else {
          out.push("<p>" + inline(b).replace(/\n/g, "<br>") + "</p>");
        }
      }
    }
    return out.join("");
  }

  var CSS =
    ":host{all:initial}" +
    "*{box-sizing:border-box}" +
    ".root{--c:#2563eb;--bg:#fff;--fg:#111827;--muted:#6b7280;--line:#e5e7eb;--bot:#f3f4f6;--code:#0f172a;" +
    "font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--fg);position:fixed;bottom:20px;z-index:2147483000}" +
    "@media (prefers-color-scheme:dark){.root{--bg:#111827;--fg:#f3f4f6;--muted:#9ca3af;--line:#374151;--bot:#1f2937}}" +
    ".right{right:20px}.left{left:20px}" +
    ".launcher{width:56px;height:56px;border-radius:50%;border:0;background:var(--c);color:#fff;cursor:pointer;" +
    "box-shadow:0 6px 20px rgba(0,0,0,.2);display:grid;place-items:center;margin-left:auto}" +
    ".left .launcher{margin-left:0}" +
    ".launcher:focus-visible,button:focus-visible,textarea:focus-visible{outline:2px solid var(--c);outline-offset:2px}" +
    ".panel{display:none;flex-direction:column;width:380px;height:560px;max-height:calc(100vh - 110px);background:var(--bg);" +
    "border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.18);overflow:hidden;margin-bottom:12px}" +
    ".open .panel{display:flex}" +
    "@media (max-width:480px){.root{bottom:12px}.right{right:12px}.left{left:12px}.panel{width:calc(100vw - 24px);height:calc(100vh - 100px)}}" +
    ".head{display:flex;align-items:center;gap:8px;padding:12px 14px;background:var(--c);color:#fff}" +
    ".head h2{font-size:15px;font-weight:600;margin:0;flex:1}" +
    ".head button{background:transparent;border:0;color:#fff;cursor:pointer;font-size:12px;opacity:.85;padding:4px 6px;border-radius:6px}" +
    ".head button:hover{opacity:1;background:rgba(255,255,255,.15)}" +
    ".log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}" +
    ".msg{max-width:88%;padding:9px 12px;border-radius:12px;word-wrap:break-word;overflow-wrap:anywhere}" +
    ".msg p{margin:0 0 8px}.msg p:last-child{margin:0}.msg ul,.msg ol{margin:4px 0 8px;padding-left:20px}" +
    ".user{align-self:flex-end;background:var(--c);color:#fff;border-bottom-right-radius:4px;white-space:pre-wrap}" +
    ".bot{align-self:flex-start;background:var(--bot);border-bottom-left-radius:4px}" +
    ".bot a{color:var(--c)}" +
    ".err{align-self:center;color:#b91c1c;font-size:13px}" +
    ".status{align-self:flex-start;color:var(--muted);font-size:12px;font-style:italic}" +
    "code{font:12.5px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:rgba(127,127,127,.15);padding:1px 4px;border-radius:4px}" +
    "pre{position:relative;background:var(--code);color:#e5e7eb;padding:10px 12px;border-radius:8px;overflow-x:auto;margin:6px 0}" +
    "pre code{background:none;padding:0;color:inherit;white-space:pre}" +
    ".copy{position:absolute;top:6px;right:6px;font-size:11px;padding:2px 7px;border-radius:5px;border:1px solid #475569;background:#1e293b;color:#cbd5e1;cursor:pointer}" +
    ".form{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line)}" +
    "textarea{flex:1;resize:none;border:1px solid var(--line);border-radius:10px;padding:8px 10px;font:inherit;color:var(--fg);background:var(--bg);max-height:120px}" +
    ".send{border:0;background:var(--c);color:#fff;border-radius:10px;padding:0 14px;font-weight:600;cursor:pointer}" +
    ".send:disabled{opacity:.5;cursor:default}" +
    ".foot{font-size:11px;color:var(--muted);text-align:center;padding:0 0 8px}";

  var ICON_CHAT =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var ICON_CLOSE =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  function Widget(opts) {
    this.opts = opts;
    this.server = (opts.server || "").replace(/\/$/, "");
    this.key = opts.agent;
    this.state = storage(this.key) || { sessionId: null, history: [], open: false };
    this.busy = false;
    this.build();
    this.loadConfig();
  }

  Widget.prototype.build = function () {
    var self = this;
    var host = document.createElement("div");
    host.setAttribute("data-support-agent", this.key);
    var shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML =
      "<style>" + CSS + "</style>" +
      '<div class="root ' + (this.opts.position === "left" ? "left" : "right") + '">' +
      '<div class="panel" role="dialog" aria-label="Support chat">' +
      '<div class="head"><h2></h2><button type="button" class="reset" title="Start a new conversation">New chat</button></div>' +
      '<div class="log" aria-live="polite"></div>' +
      '<form class="form"><textarea rows="1" placeholder="Ask a question…" aria-label="Message"></textarea>' +
      '<button class="send" type="submit">Send</button></form>' +
      '<div class="foot">AI answers can be wrong. Check the linked docs.</div>' +
      "</div>" +
      '<button class="launcher" type="button" aria-label="Open support chat">' + ICON_CHAT + "</button>" +
      "</div>";
    document.body.appendChild(host);

    var $ = function (s) { return shadow.querySelector(s); };
    this.root = $(".root");
    this.log = $(".log");
    this.input = $("textarea");
    this.sendBtn = $(".send");
    this.launcher = $(".launcher");
    this.title = $("h2");
    if (this.opts.color) this.root.style.setProperty("--c", this.opts.color);
    this.title.textContent = this.opts.title || "Support";

    this.launcher.addEventListener("click", function () { self.toggle(); });
    $(".reset").addEventListener("click", function () { self.reset(); });
    $("form").addEventListener("submit", function (e) {
      e.preventDefault();
      self.send(self.input.value);
    });
    this.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        self.send(self.input.value);
      }
    });
    this.input.addEventListener("input", function () {
      self.input.style.height = "auto";
      self.input.style.height = self.input.scrollHeight + "px";
    });
    this.log.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest(".copy");
      if (!btn) return;
      var code = btn.parentNode.querySelector("code").textContent;
      navigator.clipboard && navigator.clipboard.writeText(code).then(function () {
        btn.textContent = "Copied";
        setTimeout(function () { btn.textContent = "Copy"; }, 1200);
      });
    });
    shadow.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && self.state.open) self.close();
    });

    this.renderHistory();
    if (this.state.open || this.opts.open) this.open();
  };

  Widget.prototype.loadConfig = function () {
    var self = this;
    fetch(this.server + "/api/agents/" + encodeURIComponent(this.key) + "/config")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        if (!cfg) return;
        if (!self.opts.title) self.title.textContent = cfg.name;
        self.greeting = self.opts.greeting || cfg.greeting;
        self.renderHistory();
      })
      .catch(function () {});
  };

  Widget.prototype.save = function () {
    storage(this.key, this.state);
  };

  Widget.prototype.add = function (cls, html) {
    var el = document.createElement("div");
    el.className = "msg " + cls;
    el.innerHTML = html;
    this.log.appendChild(el);
    this.log.scrollTop = this.log.scrollHeight;
    return el;
  };

  Widget.prototype.renderHistory = function () {
    this.log.innerHTML = "";
    if (this.greeting) this.add("bot", markdown(this.greeting));
    for (var i = 0; i < this.state.history.length; i++) {
      var m = this.state.history[i];
      if (m.role === "user") this.add("user", esc(m.text));
      else this.add("bot", markdown(m.text));
    }
  };

  Widget.prototype.open = function () {
    this.state.open = true;
    this.root.classList.add("open");
    this.launcher.innerHTML = ICON_CLOSE;
    this.launcher.setAttribute("aria-label", "Close support chat");
    this.save();
    this.input.focus();
  };
  Widget.prototype.close = function () {
    this.state.open = false;
    this.root.classList.remove("open");
    this.launcher.innerHTML = ICON_CHAT;
    this.launcher.setAttribute("aria-label", "Open support chat");
    this.save();
    this.launcher.focus();
  };
  Widget.prototype.toggle = function () {
    this.state.open ? this.close() : this.open();
  };
  Widget.prototype.reset = function () {
    if (this.busy) return;
    this.state.sessionId = null;
    this.state.history = [];
    this.save();
    this.renderHistory();
    this.input.focus();
  };

  Widget.prototype.send = function (text) {
    var self = this;
    text = (text || "").trim();
    if (!text || this.busy) return;
    if (!this.state.open) this.open();
    this.busy = true;
    this.sendBtn.disabled = true;
    this.input.value = "";
    this.input.style.height = "auto";

    this.add("user", esc(text));
    this.state.history.push({ role: "user", text: text });
    this.save();

    var status = this.add("status", "Thinking…");
    var bubble = null;
    var answer = "";

    function finish(errMsg) {
      if (status.parentNode) status.remove();
      if (errMsg) self.add("err", esc(errMsg));
      if (answer) {
        self.state.history.push({ role: "assistant", text: answer });
        self.save();
      }
      self.busy = false;
      self.sendBtn.disabled = false;
      self.input.focus();
    }

    fetch(this.server + "/api/agents/" + encodeURIComponent(this.key) + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        sessionId: this.state.sessionId,
        page: { url: location.href, title: document.title },
      }),
    })
      .then(function (res) {
        if (!res.ok || !res.body) {
          return res.json().then(
            function (j) { finish(j.error || "Request failed (" + res.status + ")"); },
            function () { finish("Request failed (" + res.status + ")"); }
          );
        }
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buf = "";
        var errored = null;
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return finish(errored);
            buf += decoder.decode(r.value, { stream: true });
            var events = buf.split("\n\n");
            buf = events.pop();
            for (var i = 0; i < events.length; i++) {
              var line = events[i].replace(/^data: /, "");
              var ev;
              try { ev = JSON.parse(line); } catch (e) { continue; }
              if (ev.type === "session") {
                self.state.sessionId = ev.sessionId;
                self.save();
              } else if (ev.type === "status") {
                status.textContent = ev.message;
                if (bubble) self.log.appendChild(status);
              } else if (ev.type === "text") {
                if (!bubble) bubble = self.add("bot", "");
                answer += ev.text;
                bubble.innerHTML = markdown(answer);
                self.log.appendChild(status);
                status.textContent = "";
                var nearBottom = self.log.scrollHeight - self.log.scrollTop - self.log.clientHeight < 80;
                if (nearBottom) self.log.scrollTop = self.log.scrollHeight;
              } else if (ev.type === "error") {
                errored = ev.message;
              }
            }
            return pump();
          });
        }
        return pump();
      })
      .catch(function () {
        finish("Couldn't reach the support server.");
      });
  };

  var instance = null;
  var api = {
    __loaded: true,
    /** Mount the widget. opts: { agent, server?, title?, color?, position?, greeting?, open? } */
    init: function (opts) {
      if (instance) return api;
      if (!opts || !opts.agent) throw new Error("SupportAgent.init: `agent` is required");
      var start = function () { instance = new Widget(opts); };
      document.body ? start() : document.addEventListener("DOMContentLoaded", start);
      return api;
    },
    open: function () { instance && instance.open(); },
    close: function () { instance && instance.close(); },
    toggle: function () { instance && instance.toggle(); },
    /** Open the chat and send a question, e.g. from a "Ask AI about this" button. */
    ask: function (text) { instance && instance.send(text); },
    reset: function () { instance && instance.reset(); },
  };
  window.SupportAgent = api;

  if (script && script.dataset.agent) {
    var d = script.dataset;
    api.init({
      agent: d.agent,
      server: d.server || new URL(script.src, location.href).origin,
      title: d.title,
      color: d.color,
      position: d.position,
      greeting: d.greeting,
      open: d.open === "true",
    });
  }
})();
