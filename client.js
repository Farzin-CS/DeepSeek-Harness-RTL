(() => {
/**
 * Right-to-left (Persian / Arabic / Hebrew) typography for the Harness Web UI.
 *
 * The shell is authored left-to-right: no stylesheet sets `direction`, and no
 * element carries a `dir` attribute, so RTL messages inherit an LTR paragraph
 * level. That leaves Persian text with the wrong alignment, list markers,
 * quote bars and punctuation at line ends, and it jumbles sentences that mix
 * Persian with English words, identifiers or inline code.
 *
 * This Client half fixes that in two layers:
 *
 * 1. A stylesheet that resolves the base direction per block from its content
 *    (UAX #9 first-strong heuristic), aligns each block to its own resolved
 *    direction, keeps code left-to-right and isolated, and turns the physical
 *    paddings/borders of lists and quotes into logical ones.
 *
 * 2. A small observer that pins an explicit direction on transcript blocks
 *    where the heuristic disagrees with what a Persian reader expects: a line
 *    that *starts* with an English term but is otherwise Persian (a very common
 *    shape in technical Persian, e.g. "- useState: وضعیت کامپوننت") must
 *    still read right-to-left. Those blocks get `dir` plus a marker attribute
 *    whose rule disables the plaintext heuristic for that block.
 *
 * The composer needs no layer here: the Lexical editor it uses already applies
 * `dir="auto"` to its editable roots; plain inputs and textareas are given the
 * same attribute below as a fallback.
 */

/**
 * Stylesheet half of the fix.
 *
 * Every selector is prefixed with `:root` so the rules outrank the shipped
 * single-class CSS-module rules regardless of which stylesheet the shell
 * injects first. Code-facing declarations come after the prose ones, and the
 * pinned-direction rule comes last so a pinned block ignores the heuristic.
 */
const CSS = `
/* ---- 1. Paragraph direction ------------------------------------------- */
:root [data-chat-flow],
:root [class*="_markdown_"] {
  unicode-bidi: plaintext;
}

:root [data-chat-flow-kind] :where(p, li, h1, h2, h3, h4, h5, h6, blockquote, dt, dd, figcaption, summary, td, th),
:root [class*="_markdown_"] :where(p, li, h1, h2, h3, h4, h5, h6, blockquote, dt, dd, figcaption, summary, td, th) {
  unicode-bidi: plaintext;
  text-align: start;
}

/* User and steering messages are plain inline text, not Markdown. */
:root [data-chat-flow-kind="user"],
:root [data-chat-flow-kind="steering"] {
  unicode-bidi: plaintext;
  text-align: start;
}

/* Inline elements stay part of their paragraph's bidi run instead of
   isolating at every span boundary. */
:root [data-chat-flow-kind] :where(a, abbr, b, cite, em, i, mark, q, s, small, span, strong, sub, sup, time, u),
:root [class*="_markdown_"] :where(a, abbr, b, cite, em, i, mark, q, s, small, span, strong, sub, sup, time, u) {
  unicode-bidi: normal;
}

/* ---- 2. Code stays left-to-right -------------------------------------- */
:root :where(pre, code, kbd, samp) {
  direction: ltr;
  unicode-bidi: isolate;
  text-align: left;
}

:root :where([class*="md-code-block"]) {
  direction: ltr;
  unicode-bidi: isolate;
}

/* ---- 3. Logical geometry ---------------------------------------------- */
:root [class*="_markdown_"] :where(ul, ol) {
  padding-left: 0;
  padding-inline-start: 18px;
}

:root [class*="_markdown_"] :where(ul, ol) ol {
  padding-inline-start: 0;
}

:root [class*="_markdown_"] blockquote {
  border-left: 0;
  border-inline-start: 2px solid var(--dsw-alias-label-caption, currentColor);
  padding-left: 0;
  padding-inline-start: 14px;
}

:root [class*="_markdown_"] input[type="checkbox"] {
  margin: 0;
  margin-inline-end: 8px;
}

/* ---- 4. Pinned direction wins over the heuristic ---------------------- */
:root [data-dsh-dir] {
  unicode-bidi: normal;
}
`;

window.__ModuleLoader__.load({
  id: '@local/dsh-rtl-bidi',
  factory() {
    const DIR_ATTR = 'data-dsh-dir';

    /** Blocks whose base direction is resolved and, when needed, pinned. */
    const BLOCK_SELECTOR = [
      'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'blockquote', 'dt', 'dd', 'figcaption', 'summary', 'td', 'th', 'ul', 'ol',
    ].join(', ');

    /** Content that must never influence a text block's direction. */
    const SKIP_SELECTOR = 'code, pre, .md-code-block, .katex, .katex-display, script, style, textarea';

    /** Surfaces this plugin is responsible for: the transcript and Markdown. */
    const SCOPE_SELECTOR = '[data-chat-flow], [class*="_markdown_"]';

    /** Plain controls that need the browser's native auto-direction. */
    const EDITABLE_SELECTOR = 'textarea, input[type="text"], input[type="search"], input:not([type]), [contenteditable=""], [contenteditable="true"]';

    const LETTER = /\p{L}/u;
    const RTL_LETTER = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}\p{Script=Samaritan}]/u;

    /**
     * Count strong letters and find the first one in a block.
     * Code, math and form controls are skipped so an identifier or a snippet
     * cannot outvote the prose around it.
     * @param element - block whose text content is measured.
     * @returns counted strong RTL/LTR letters, and the first strong direction.
     */
    function scanLetters(element) {
      let rtl = 0;
      let ltr = 0;
      let first = null;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (parent === null || parent.closest(SKIP_SELECTOR) !== null) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = node.nodeValue;
        if (text === null || text === '') continue;
        for (const char of text) {
          if (!LETTER.test(char)) continue;
          const isRtl = RTL_LETTER.test(char);
          if (isRtl) rtl += 1;
          else ltr += 1;
          if (first === null) first = isRtl ? 'rtl' : 'ltr';
        }
      }
      return { rtl, ltr, first };
    }

    /**
     * Choose the direction to pin on one block.
     * @param element - block whose text content decides the direction.
     * @returns 'rtl', 'ltr', or null when the block holds no strong character
     *   (digits and punctuation only) and should keep the inherited behaviour.
     */
    function chooseDirection(element) {
      const { rtl, ltr, first } = scanLetters(element);
      if (first === null) return null;
      if (first === 'rtl') return 'rtl';
      // English-led but overwhelmingly Persian: the Persian reading direction wins.
      if (rtl >= 4 && rtl >= ltr * 2) return 'rtl';
      return 'ltr';
    }

    /**
     * Pin (or clear) the direction of one block so the stylesheet and the
     * browser agree on it. Idempotent: repeated observer passes are free.
     * @param element - block to update.
     */
    function syncBlock(element) {
      if (element.closest(SCOPE_SELECTOR) === null) return;
      const direction = chooseDirection(element);
      if (direction === null) {
        if (element.hasAttribute(DIR_ATTR)) {
          element.removeAttribute(DIR_ATTR);
          element.removeAttribute('dir');
        }
        return;
      }
      if (element.getAttribute(DIR_ATTR) === direction) return;
      element.setAttribute(DIR_ATTR, direction);
      element.setAttribute('dir', direction);
    }

    /**
     * Give a form control the browser's native auto-direction so typing
     * Persian moves the caret and the alignment to the right.
     * @param element - candidate form control.
     */
    function syncEditable(element) {
      if (!(element instanceof Element)) return;
      if (!element.matches(EDITABLE_SELECTOR)) return;
      if (element.hasAttribute('dir')) return;
      element.setAttribute('dir', 'auto');
    }

    /**
     * Collect the blocks inside a freshly added subtree, skipping subtrees
     * that cannot contain transcript content.
     * @param node - added element.
     * @param out - accumulating set.
     */
    function collectBlocks(node, out) {
      if (!(node instanceof Element)) return;
      if (node.matches(BLOCK_SELECTOR)) out.add(node);
      if (node.firstElementChild === null) return;
      if (node.closest(SCOPE_SELECTOR) === null && node.querySelector(SCOPE_SELECTOR) === null) return;
      for (const block of node.querySelectorAll(BLOCK_SELECTOR)) out.add(block);
    }

    /** Browser half of the bundle. */
    return {
      apply(ctx) {
        const cleanups = [];

        const style = document.createElement('style');
        style.id = 'dsh-rtl-bidi-style';
        style.textContent = CSS;
        document.head.appendChild(style);
        cleanups.push(() => style.remove());

        // Blocks whose text changed since the last animation frame. The flush
        // is time-boxed so restoring a long transcript never blocks a frame.
        const dirty = new Set();
        let frame = 0;
        const FRAME_BUDGET_MS = 6;

        const flush = () => {
          frame = 0;
          const started = performance.now();
          for (const block of dirty) {
            dirty.delete(block);
            if (block.isConnected) syncBlock(block);
            if (performance.now() - started >= FRAME_BUDGET_MS) {
              frame = window.requestAnimationFrame(flush);
              return;
            }
          }
        };

        const schedule = () => {
          if (frame !== 0) return;
          frame = window.requestAnimationFrame(flush);
        };

        const observer = new MutationObserver((records) => {
          for (const record of records) {
            if (record.type === 'characterData') {
              const parent = record.target.parentElement;
              const block = parent === null ? null : parent.closest(BLOCK_SELECTOR);
              if (block !== null && block.closest(SCOPE_SELECTOR) !== null) dirty.add(block);
              continue;
            }
            for (const node of record.addedNodes) {
              if (node.nodeType !== Node.ELEMENT_NODE) continue;
              if (node.matches(EDITABLE_SELECTOR)) syncEditable(node);
              for (const editable of node.querySelectorAll(EDITABLE_SELECTOR)) syncEditable(editable);
              collectBlocks(node, dirty);
            }
          }
          if (dirty.size > 0) schedule();
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        cleanups.push(() => {
          observer.disconnect();
          if (frame !== 0) window.cancelAnimationFrame(frame);
          frame = 0;
          dirty.clear();
        });

        // Existing content: a restored transcript and already-mounted controls.
        for (const control of document.querySelectorAll(EDITABLE_SELECTOR)) syncEditable(control);
        for (const block of document.querySelectorAll(BLOCK_SELECTOR)) dirty.add(block);
        flush();

        // Controls may mount (or remount) whenever a Session opens.
        const onFocusIn = (event) => {
          const target = event.target;
          if (target instanceof Element) syncEditable(target);
        };
        document.addEventListener('focusin', onFocusIn, true);
        cleanups.push(() => document.removeEventListener('focusin', onFocusIn, true));

        ctx.effect(() => () => {
          for (const cleanup of cleanups.reverse()) cleanup();
        });
      },
    };
  },
});
})();
