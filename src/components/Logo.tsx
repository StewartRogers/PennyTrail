import Image from "next/image";
import type { CSSProperties } from "react";
import logo from "@/assets/pennytrail-logo.png";

// The PennyTrail wordmark in a white, bordered box. Imported statically so
// Next serves it from /_next/static — the proxy lets that through for a
// signed-out visitor, which the login page needs (a file under public/
// would be redirected to /login). Width and height are passed explicitly,
// matching the file, so it also renders where a .png import is a plain URL
// (Vitest).
export function Logo({ padding = "10px 12px", style }: { padding?: CSSProperties["padding"]; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding,
        lineHeight: 0,
        ...style,
      }}
    >
      <Image src={logo} alt="PennyTrail" width={720} height={170} preload style={{ width: "100%", height: "auto" }} />
    </div>
  );
}
