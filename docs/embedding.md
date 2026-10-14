# Embedding the widget

The widget is one script tag. It renders inside a Shadow DOM, so your site's CSS can't break it and its CSS can't leak into your site.

## Plain HTML

Add this before `</body>` on any page:

```html
<script src="http://localhost:3000/widget.js" data-agent="my-project" defer></script>
```

Replace `http://localhost:3000` with wherever the server is deployed and `my-project` with your agent id.

## Script attributes

| Attribute | Default | What it does |
| --- | --- | --- |
| `data-agent` | (required) | Agent id, e.g. `my-project` |
| `data-server` | origin of the script URL | API server base URL, if different from where widget.js is served |
| `data-title` | agent name | Header text |
| `data-color` | `#1f6f50` | Accent color (any CSS color). Before the redesign the default was blue; set `data-color="#2563eb"` to keep it |
| `data-position` | `right` | `left` or `right` corner |
| `data-greeting` | agent greeting | First message shown in the chat |
| `data-hint` | (none) | One line shown beside the closed bubble once per visit, e.g. "Questions? Ask here." Up to 80 characters |
| `data-open` | `false` | `true` opens the chat on page load |

## React / Next.js

Load the script once, then call `SupportAgent.init`. In Next.js App Router, put this in your root layout:

```tsx
import Script from "next/script";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
          src="https://support.example.com/widget.js"
          data-agent="my-project"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
```

For plain React (Vite, CRA), use an effect:

```tsx
import { useEffect } from "react";

export function SupportWidget() {
  useEffect(() => {
    const s = document.createElement("script");
    s.src = "https://support.example.com/widget.js";
    s.dataset.agent = "my-project";
    s.defer = true;
    document.body.appendChild(s);
  }, []);
  return null;
}
```

## Vue / Svelte / anything else

Same idea: append the script tag once when the app mounts. The widget guards against loading twice.

## JavaScript API

After the script loads, `window.SupportAgent` is available:

```js
SupportAgent.open();     // open the chat panel
SupportAgent.close();
SupportAgent.toggle();
SupportAgent.reset();    // start a new conversation
SupportAgent.ask("How do I configure webhooks?"); // open and send a question
```

`ask` is handy for "Ask AI about this" buttons next to docs sections or error messages.

If you omit `data-agent`, the widget doesn't mount itself; call `init` when you're ready:

```js
SupportAgent.init({
  agent: "my-project",
  server: "https://support.example.com",
  title: "Help",
  color: "#16a34a",
  position: "left",
  hint: "Questions? Ask here.",
});
```

## Page context

Every message includes the visitor's current URL and page title, so questions like "how do I do what this page describes?" work without the visitor copying anything.

## Conversation persistence

The conversation survives page navigations within the same tab (stored in `sessionStorage`). Closing the tab or clicking **New chat** starts over. Server-side sessions expire after one hour of inactivity.
