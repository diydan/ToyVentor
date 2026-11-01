import { useEffect, useState, type CSSProperties } from "react";

// model-viewer is a web component; declare the small attribute surface we use.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": {
        src?: string;
        alt?: string;
        ar?: boolean;
        "ar-modes"?: string;
        "camera-controls"?: boolean;
        "shadow-intensity"?: string;
        "interaction-prompt"?: string;
        "field-of-view"?: string;
        "camera-orbit"?: string;
        style?: CSSProperties;
        className?: string;
      };
    }
  }
}

let modelViewerPromise: Promise<unknown> | null = null;
let modelViewerLoaded = false;
const preloadedGlbUrls = new Set<string>();

/** Start loading the ~600 KB `@google/model-viewer` bundle once per session. */
export function ensureModelViewer(): Promise<unknown> {
  if (!modelViewerPromise) {
    modelViewerPromise = import("@google/model-viewer").then((mod) => {
      modelViewerLoaded = true;
      return mod;
    });
  }
  return modelViewerPromise;
}

/** Prime the browser / service-worker cache for a quantized `.glb` in parallel with JS load. */
export function preloadPartGlb(glbFile: string | undefined): void {
  if (!glbFile || typeof document === "undefined") return;
  const url = `/parts-glb/${glbFile}`;
  if (preloadedGlbUrls.has(url)) return;
  preloadedGlbUrls.add(url);
  if (document.head) {
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "fetch";
    link.href = url;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }
}

const STAGE_STYLE: CSSProperties = {
  width: "100%",
  height: 220,
  background: "radial-gradient(circle at 50% 35%, #22337e, #080f2b)",
  borderRadius: 12,
  border: "1px solid var(--glass-line)",
};

const FILL_STYLE: CSSProperties = { width: "100%", height: "100%" };

/**
 * 3D/AR preview of one part's real quantized GLB (public/parts-glb). Sits still:
 * no auto-rotate. Preloads `/parts-glb/${glbFile}` concurrently with the
 * `@google/model-viewer` chunk and reserves container height so layout never shifts.
 */
export function PartPreview({
  glbFile,
  partName,
  fill = false,
  cameraOrbit,
}: {
  glbFile: string;
  partName: string;
  /** Fill the parent box (try-on overlay) instead of a fixed stage. */
  fill?: boolean;
  cameraOrbit?: string;
}) {
  const [ready, setReady] = useState(modelViewerLoaded);

  useEffect(() => {
    preloadPartGlb(glbFile);
  }, [glbFile]);

  useEffect(() => {
    if (modelViewerLoaded) {
      setReady(true);
      return;
    }
    let live = true;
    ensureModelViewer().then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const boxStyle = fill ? FILL_STYLE : STAGE_STYLE;

  if (!ready) {
    return (
      <div
        className="part-preview-placeholder"
        style={{
          ...boxStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <p className="fine-print" style={{ margin: 0 }}>
          Loading 3D preview…
        </p>
      </div>
    );
  }

  return (
    <model-viewer
      className="part-preview"
      src={`/parts-glb/${glbFile}`}
      alt={`${partName} in 3D`}
      camera-controls
      interaction-prompt="none"
      field-of-view={fill ? "25deg" : undefined}
      camera-orbit={cameraOrbit}
      ar
      ar-modes="webxr scene-viewer quick-look"
      shadow-intensity="0.7"
      style={boxStyle}
    />
  );
}
