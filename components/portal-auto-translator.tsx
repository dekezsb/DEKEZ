"use client";

import { useEffect } from "react";
import { useLanguage } from "@/components/language-provider";
import { portalText } from "@/lib/i18n-portal";
import type { AppRole } from "@/lib/auth/roles";

const translatedAttributes = ["aria-label", "placeholder", "title"] as const;
const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();

export function PortalAutoTranslator({ role }: { role: AppRole | null }) {
  const { locale } = useLanguage();

  useEffect(() => {
    if (!role || role === "super_admin") return;
    let applying = false;

    function translateTextNode(node: Text) {
      const current = node.nodeValue ?? "";
      const trimmed = current.trim();
      if (!trimmed) return;

      const source = originalText.get(node) ?? current;
      originalText.set(node, source);
      const sourceTrimmed = source.trim();
      const translated = portalText(locale, sourceTrimmed);

      const start = source.slice(0, source.indexOf(sourceTrimmed));
      const end = source.slice(source.indexOf(sourceTrimmed) + sourceTrimmed.length);
      const nextValue = `${start}${translated}${end}`;
      if (current !== nextValue) node.nodeValue = nextValue;
    }

    function translateElement(element: Element) {
      if (
        element.closest("[data-no-translate]") ||
        ["SCRIPT", "STYLE", "CODE"].includes(element.tagName)
      ) {
        return;
      }

      for (const attribute of translatedAttributes) {
        const value = element.getAttribute(attribute);
        if (!value) continue;
        let originals = originalAttributes.get(element);
        if (!originals) {
          originals = new Map();
          originalAttributes.set(element, originals);
        }
        const source = originals.get(attribute) ?? value;
        originals.set(attribute, source);
        const translated = portalText(locale, source);
        if (value !== translated) element.setAttribute(attribute, translated);
      }

      for (const child of Array.from(element.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          translateTextNode(child as Text);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          translateElement(child as Element);
        }
      }
    }

    function applyTranslations() {
      if (applying) return;
      applying = true;
      translateElement(document.body);
      applying = false;
    }

    applyTranslations();
    const observer = new MutationObserver(() => {
      window.requestAnimationFrame(applyTranslations);
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: [...translatedAttributes],
      childList: true,
      characterData: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, [locale, role]);

  return null;
}
