"use client";

import dynamic from "next/dynamic";

const CallClient = dynamic(() => import("./call-client"), {
  ssr: false,
});

export default function Home() {
  return <CallClient />;
}
