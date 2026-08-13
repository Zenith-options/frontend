import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{
        width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#14130F",
      }}>
        <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
          <polygon points="10,2 18,18 2,18" stroke="#C9974C" strokeWidth="1.5" fill="rgba(201,151,76,0.14)" strokeLinejoin="round" />
          <polygon points="10,7 14.5,16 5.5,16" fill="#C9974C" opacity="0.5" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
