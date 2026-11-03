import { useEffect, useState } from "react";
import { describeObject, type PropLang } from "../../../lib/propNames";
import { getPropLang, onPropLangChange, PROP_LANG_CHOICES, setPropLang } from "../../../lib/propSpeech";
import { sayObject, stopObjectVoice } from "../../../lib/propVoice";

/** The chosen "say what it is" language, kept in step across the menu and the sheet. */
export function usePropLang(): PropLang {
  const [lang, setLang] = useState<PropLang>(getPropLang);
  useEffect(() => onPropLangChange(setLang), []);
  return lang;
}

/** What the game says for the sample object, in a language (also the picker's preview text). */
function sample(lang: PropLang): string {
  return describeObject({ noun: "tree", color: "green" }, lang)?.text ?? "";
}

/**
 * Pick the language the game names things in ("green tree", "árbol verde", "grüner Baum"), or turn the naming off. Choosing one
 * says the sample out loud, which is also the kid's confirmation that it worked.
 */
export function LanguageSheet({ onClose }: { onClose: () => void }) {
  const lang = usePropLang();
  const choose = (value: PropLang) => {
    setPropLang(value);
    const d = describeObject({ noun: "tree", color: "green" }, value);
    if (d) sayObject({ noun: "tree", color: "green", lang: d.lang, text: d.text });
    else stopObjectVoice();
  };
  return (
    <>
      <div className="tv-sh-top">
        <b className="tv-sh-title">Words &amp; Language</b>
        <button type="button" className="tv-ctl tv-ctl-primary" onClick={onClose}>
          Done
        </button>
      </div>
      <p className="tv-moves">
        Tap a tree, a lamp, a ball, a cloud… and the game says what it is and what colour. Pick the language it speaks.
      </p>
      <div className="tv-chips" role="group" aria-label="Language">
        {PROP_LANG_CHOICES.map((c) => (
          <button
            key={c.value}
            type="button"
            className="tv-sc"
            aria-pressed={c.value === lang}
            onClick={() => choose(c.value)}
          >
            <span>{c.label}</span>
            {c.value !== "off" && <small style={{ opacity: 0.75, marginLeft: 6 }}>{sample(c.value)}</small>}
          </button>
        ))}
      </div>
    </>
  );
}
