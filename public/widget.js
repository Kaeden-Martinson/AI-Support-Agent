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
  function anchor(href, text) {
    return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + text + "</a>";
  }
  function inline(s) {
    // Finished HTML (code, links) is parked in placeholders so later passes can't touch it.
    var held = [];
    var hold = function (html) {
      held.push(html);
      return "\u0000" + (held.length - 1) + "\u0000";
    };
    s = s
      .replace(/`([^`]+)`/g, function (_, c) {
        return hold("<code>" + c + "</code>");
      })
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, text, url) {
        var href = safeHref(url);
        return href ? hold(anchor(href, text)) : text;
      })
      // <https://...> autolinks (escaped by now) and bare URLs, minus trailing punctuation.
      .replace(/&lt;(https?:\/\/[^\s]+?)&gt;/g, function (m, url) {
        var href = safeHref(url);
        return href ? hold(anchor(href, url)) : m;
      })
      .replace(/https?:\/\/[^\s<\u0000]+?(?=[.,;:!?)]*(?:\s|$|\u0000))/g, function (url) {
        var href = safeHref(url);
        return href ? hold(anchor(href, url)) : url;
      })
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
    return s.replace(/\u0000(\d+)\u0000/g, function (_, i) {
      return held[+i];
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

  // Links an answer used, shown as "Sources" chips: absolute http(s) only, deduped, first four.
  function collectSources(md) {
    var out = [];
    var seen = {};
    var text = md.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
    var re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?])/g;
    var m;
    while ((m = re.exec(text)) && out.length < 4) {
      var href = m[2] || m[3] || m[4];
      if (seen[href]) continue;
      seen[href] = true;
      out.push({ href: href, text: m[1] || href.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") });
    }
    return out;
  }

  function sourcesHtml(md) {
    var list = collectSources(md);
    if (!list.length) return "";
    return (
      '<div class="src"><span>Sources</span>' +
      list
        .map(function (s) {
          return '<a class="chip" href="' + esc(s.href) + '" target="_blank" rel="noopener noreferrer">' + esc(s.text) + "</a>";
        })
        .join("") +
      "</div>"
    );
  }

  var CSS =
    ":host{all:initial}" +
    "*{box-sizing:border-box}[hidden]{display:none!important}" +
    ".root{--c:#1f6f50;--bg:#fff;--fg:#18181b;--muted:#66666b;--line:#e3e1da;--chip:#eceae4;--code:#1b1b1f;" +
    "--err:#a3321b;--errbg:#fbf3f0;--errline:#ecd2c9;" +
    "font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--fg);position:fixed;bottom:20px;z-index:2147483000}" +
    "@media (prefers-color-scheme:dark){.root{--bg:#18181b;--fg:#ededea;--muted:#9a9a9f;--line:#2e2e33;--chip:#27272b;--code:#0e0e10;" +
    "--err:#f0a08a;--errbg:#2a1c18;--errline:#4a2c24}}" +
    ".right{right:20px}.left{left:20px}" +
    ".launcher{width:46px;height:46px;border-radius:50%;border:0;background:var(--c);color:#fff;cursor:pointer;display:grid;place-items:center;margin-left:auto}" +
    ".left .launcher{margin-left:0}" +
    "button:focus-visible,a:focus-visible{outline:2px solid var(--c);outline-offset:2px}" +
    ".panel{display:none;flex-direction:column;width:380px;height:560px;max-height:calc(100vh - 100px);background:var(--bg);" +
    "border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 28px rgba(24,24,27,.10);overflow:hidden;margin-bottom:12px}" +
    ".open .panel{display:flex}" +
    "@media (max-width:480px){.root{bottom:12px}.right{right:12px}.left{left:12px}.panel{width:calc(100vw - 24px);height:calc(100vh - 90px)}}" +
    ".head{display:flex;align-items:center;gap:4px;padding:10px 10px 10px 14px;border-bottom:1px solid var(--line)}" +
    ".head h2{font-size:14px;font-weight:600;margin:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".head button{background:transparent;border:0;color:var(--muted);cursor:pointer;font:inherit;font-size:12.5px;padding:4px 7px;border-radius:4px;display:grid;place-items:center}" +
    ".head button:hover{color:var(--fg);background:var(--chip)}" +
    ".log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:12px}" +
    ".msg{word-wrap:break-word;overflow-wrap:anywhere}" +
    ".msg p{margin:0 0 8px}.msg p:last-child{margin:0}.msg ul,.msg ol{margin:4px 0 8px;padding-left:20px}" +
    ".user{align-self:flex-end;max-width:85%;background:var(--c);color:#fff;padding:7px 11px;border-radius:12px 12px 3px 12px;white-space:pre-wrap}" +
    ".bot{align-self:stretch}" +
    ".bot a{color:var(--c);font-weight:600;text-decoration:none}.bot a:hover{text-decoration:underline}" +
    ".stat{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:12.5px}" +
    ".stat::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--c);animation:sa-pulse 1.2s ease-in-out infinite}" +
    ".skel{height:10px;border-radius:3px;margin-top:8px;background:linear-gradient(90deg,var(--chip) 0,var(--bg) 50%,var(--chip) 100%);" +
    "background-size:200% 100%;animation:sa-shim 1.4s linear infinite}" +
    ".skel:nth-child(2){width:92%}.skel:nth-child(3){width:78%}.skel:nth-child(4){width:60%}" +
    "@keyframes sa-pulse{50%{opacity:.3}}@keyframes sa-shim{to{background-position:-200% 0}}" +
    "@media (prefers-reduced-motion:reduce){.stat::before,.skel{animation:none}}" +
    ".err{align-self:stretch;border:1px solid var(--errline);background:var(--errbg);color:var(--err);border-radius:6px;padding:9px 11px;font-size:13px}" +
    ".retry{display:block;margin-top:4px;padding:0;border:0;background:none;color:var(--fg);font:inherit;font-weight:600;" +
    "text-decoration:underline;text-underline-offset:2px;cursor:pointer}" +
    ".src{margin-top:10px;padding-top:9px;border-top:1px dashed var(--line);display:flex;flex-wrap:wrap;align-items:center;gap:5px}" +
    ".src span{width:100%;font-size:11px;color:var(--muted)}" +
    ".bot .chip{font-size:12px;font-weight:600;color:var(--c);border:1px solid var(--line);border-radius:4px;padding:1px 8px;text-decoration:none}" +
    "code{font:12.5px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--chip);padding:1px 4px;border-radius:3px}" +
    "pre{position:relative;background:var(--code);color:#e3e3e3;padding:10px 12px;border-radius:6px;overflow-x:auto;margin:8px 0}" +
    "pre code{background:none;padding:0;color:inherit;white-space:pre}" +
    ".copy{position:absolute;top:6px;right:6px;font:11px system-ui,sans-serif;padding:1px 7px;border-radius:4px;border:1px solid #3a3a40;" +
    "background:transparent;color:#a1a1a6;cursor:pointer}" +
    ".form{margin:0;padding:10px 10px 0;border-top:1px solid var(--line)}" +
    ".field{display:flex;align-items:flex-end;gap:6px;border:1px solid var(--line);border-radius:9px;padding:5px 5px 5px 10px;background:var(--bg)}" +
    ".field:focus-within{border-color:var(--c)}" +
    "textarea{flex:1;resize:none;border:0;outline:0;padding:4px 0;font:inherit;color:var(--fg);background:transparent;max-height:120px}" +
    ".send{flex-shrink:0;width:28px;height:28px;border:0;border-radius:6px;background:var(--c);color:#fff;display:grid;place-items:center;cursor:pointer}" +
    ".send:disabled{background:var(--line);cursor:default}" +
    ".foot{font-size:11px;color:var(--muted);text-align:center;padding:6px 12px 8px}" +
    ".sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}";

  var ICON_CHAT =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var ICON_CLOSE =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var ICON_X =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var ICON_SEND =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';

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
      '<div class="head"><h2></h2>' +
      '<button type="button" class="reset" hidden>New chat</button>' +
      '<button type="button" class="x" aria-label="Close support chat">' + ICON_X + "</button></div>" +
      '<div class="log" aria-live="polite"></div>' +
      '<div class="sr" aria-live="polite"></div>' +
      '<form class="form"><div class="field"><textarea rows="1" placeholder="Ask a question…" aria-label="Message"></textarea>' +
      '<button class="send" type="submit" aria-label="Send">' + ICON_SEND + "</button></div></form>" +
      '<div class="foot">Answers can be wrong. Check the linked pages.</div>' +
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
    this.resetBtn = $(".reset");
    this.sr = $(".sr");
    this.foot = $(".foot");
    if (this.opts.color) this.root.style.setProperty("--c", this.opts.color);
    this.title.textContent = this.opts.title || "Support";

    this.launcher.addEventListener("click", function () { self.toggle(); });
    $(".reset").addEventListener("click", function () { self.reset(); });
    $(".x").addEventListener("click", function () { self.close(); });
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
        self.foot.textContent = "Answers come from " + cfg.name + "'s docs and can be wrong.";
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
      else this.add("bot", markdown(m.text) + sourcesHtml(m.text));
    }
    this.updateChrome();
  };

  // "New chat" and the follow-up placeholder only make sense once a conversation exists.
  Widget.prototype.updateChrome = function () {
    var started = this.state.history.length > 0;
    this.resetBtn.hidden = !started;
    this.input.placeholder = started ? "Ask a follow-up…" : "Ask a question…";
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

  /** Send a question. With retry=true, resend the last question without adding it to the log again. */
  Widget.prototype.send = function (text, retry) {
    var self = this;
    text = (text || "").trim();
    if (!text || this.busy) return;
    if (!this.state.open) this.open();
    this.busy = true;
    this.sendBtn.disabled = true;
    if (!retry) {
      this.input.value = "";
      this.input.style.height = "auto";
      this.add("user", esc(text));
      this.state.history.push({ role: "user", text: text });
      this.save();
      this.updateChrome();
    }

    // Placeholder until the first words arrive: a live status line and three shimmer lines.
    var pending = document.createElement("div");
    pending.className = "msg bot pending";
    pending.innerHTML =
      '<div class="stat" aria-hidden="true">Searching docs…</div><div class="skel"></div><div class="skel"></div><div class="skel"></div>';
    this.log.appendChild(pending);
    this.log.scrollTop = this.log.scrollHeight;
    var statusEl = pending.querySelector(".stat");
    var announced = false;
    var bubble = null;
    var answer = "";

    function finish(errMsg) {
      pending.remove();
      if (answer) {
        bubble.innerHTML = markdown(answer) + sourcesHtml(answer);
        self.state.history.push({ role: "assistant", text: answer });
        self.save();
      }
      if (errMsg) {
        // Offer a retry only when nothing was answered, so a retry can't duplicate a partial answer.
        var box = self.add("err", esc(errMsg) + (answer ? "" : '<button type="button" class="retry">Try again</button>'));
        var retryBtn = box.querySelector(".retry");
        if (retryBtn) {
          retryBtn.addEventListener("click", function () {
            box.remove();
            self.send(text, true);
          });
        }
      }
      self.busy = false;
      self.sendBtn.disabled = false;
      self.updateChrome();
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
                statusEl.textContent = ev.message;
                if (!announced) {
                  self.sr.textContent = ev.message;
                  announced = true;
                }
              } else if (ev.type === "text") {
                if (!bubble) {
                  pending.remove();
                  bubble = self.add("bot", "");
                }
                answer += ev.text;
                bubble.innerHTML = markdown(answer);
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
    /** For tests only; not a stable API. */
    _internals: { markdown: markdown, collectSources: collectSources },
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
