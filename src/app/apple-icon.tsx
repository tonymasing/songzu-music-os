import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#1f7a68",
          borderRadius: "38px",
          color: "#20241f",
          display: "flex",
          height: "180px",
          justifyContent: "center",
          width: "180px"
        }}
      >
        <div
          style={{
            alignItems: "center",
            background: "#f5f4ee",
            borderRadius: "50%",
            display: "flex",
            fontSize: "92px",
            fontWeight: 800,
            height: "126px",
            justifyContent: "center",
            lineHeight: 1,
            width: "126px"
          }}
        >
          ♪
        </div>
      </div>
    ),
    size
  );
}
