"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function SignaturePad() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [signatureData, setSignatureData] = useState("");

  function getPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    const point = getPoint(event);
    context.strokeStyle = "#111827";
    context.lineWidth = 2;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(point.x, point.y);
    setDrawing(true);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) {
      return;
    }
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    const point = getPoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
    setSignatureData(canvas.toDataURL("image/png"));
  }

  function stop() {
    setDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      setSignatureData(canvas.toDataURL("image/png"));
    }
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    setSignatureData("");
  }

  return (
    <div className="space-y-3">
      <canvas
        className="h-44 w-full touch-none rounded-md border border-[#d7dde5] bg-white"
        height={220}
        onPointerDown={start}
        onPointerLeave={stop}
        onPointerMove={move}
        onPointerUp={stop}
        ref={canvasRef}
        width={720}
      />
      <input name="signatureData" type="hidden" value={signatureData} />
      <Button onClick={clear} type="button" variant="outline">Clear signature</Button>
    </div>
  );
}
