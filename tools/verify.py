"""Structural check for the static build: tag balance + brace balance.

Run:  python tools/verify.py
Exits non-zero if the markup is unbalanced or an anchor/id referenced by the
script or the navigation is missing from index.html.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

VOID = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}

JS_IDS = ["scene", "loader", "nav", "navRail", "progress", "contactForm", "formStatus", "year"]
JS_CLASSES = ["is-loading", "is-done", "is-pinned", "is-in", "is-active",
              "reveal-scroll", "has-error", "form-status", "is-ok", "is-bad", "no-webgl"]


def read(name):
    with open(os.path.join(ROOT, name), encoding="utf-8") as fh:
        return fh.read()


def check_tags(html):
    stack = []
    errors = []
    for m in re.finditer(r"<(/?)([a-zA-Z][\w-]*)([^>]*?)(/?)>", html):
        closing, tag, _attrs, selfclose = m.groups()
        t = tag.lower()
        if t in VOID or selfclose:
            continue
        if closing:
            if stack and stack[-1] == t:
                stack.pop()
            else:
                errors.append("unexpected close </%s> (open: %s)" % (t, stack[-1] if stack else "-"))
        else:
            stack.append(t)
    return stack, errors


def main():
    html = read("index.html")
    css = read("styles.css")
    js = read("app.js")
    problems = []

    unclosed, tag_errors = check_tags(html)
    if unclosed:
        problems.append("unclosed tags: %s" % ", ".join(unclosed))
    if tag_errors:
        problems.extend(tag_errors[:10])

    for label, text in (("styles.css", css), ("app.js", js)):
        if text.count("{") != text.count("}"):
            problems.append("%s braces unbalanced: %d open / %d close"
                            % (label, text.count("{"), text.count("}")))

    ids = set(re.findall(r'id="([^"]+)"', html))
    for wanted in JS_IDS:
        if wanted not in ids:
            problems.append("app.js expects #%s, missing from index.html" % wanted)

    targets = set(re.findall(r'href="#([\w-]+)"', html))
    for target in sorted(targets):
        if target not in ids:
            problems.append("link target #%s has no matching id" % target)

    for cls in JS_CLASSES:
        if "." + cls not in css:
            problems.append("app.js toggles .%s, not styled in styles.css" % cls)

    if problems:
        print("FAIL (%d)" % len(problems))
        for p in problems:
            print("  - " + p)
        return 1

    print("OK  index.html markup balanced (%d elements deep at end)" % len(unclosed))
    print("OK  styles.css + app.js braces balanced")
    print("OK  %d ids, %d anchor targets, %d js classes all resolve" % (len(ids), len(targets), len(JS_CLASSES)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
