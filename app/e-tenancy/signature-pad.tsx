"use client";

import { Check, Eraser, PenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

type SignaturePadProps = {
  onSignatureChange?: (hasSignature: boolean) => void;
};

function SignatureStatus({ hasSignature }: { hasSignature: boolean }) {
  return (
    <div
      aria-live="polite"
      className={`flex items-center gap-2 text-sm font-medium ${
        hasSignature ? "text-[#126b5f]" : "text-gray-500"
      }`}
    >
      {hasSignature ? (
        <>
          <Check aria-hidden="true" className="size-4" />
          Signature captured
        </>
      ) : (
        <>
          <PenLine aria-hidden="true" className="size-4" />
          Sign inside the box using your finger
        </>
      )}
    </div>
  );
}

export function SignatureSubmitButton({
  disabled,
}: {
  disabled: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      className="h-12 w-full sm:w-auto"
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? "Saving signed agreement..." : "Confirm & sign agreement"}
    </Button>
  );
}

export function SignaturePad({ onSignatureChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const hasSignatureRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [signatureData, setSignatureData] = useState("");
  const hasSignature = signatureData.length > 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    function resizeCanvas() {
      if (!canvas || hasSignatureRef.current) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      const context = canvas.getContext("2d");
      context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

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
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getPoint(event);
    context.strokeStyle = "#111827";
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineTo(point.x + 0.01, point.y + 0.01);
    context.stroke();
    lastPointRef.current = point;
    drawingRef.current = true;
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) {
      return;
    }
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    event.preventDefault();
    const point = getPoint(event);
    const lastPoint = lastPointRef.current;
    if (lastPoint) {
      const midpoint = {
        x: (lastPoint.x + point.x) / 2,
        y: (lastPoint.y + point.y) / 2,
      };
      context.quadraticCurveTo(lastPoint.x, lastPoint.y, midpoint.x, midpoint.y);
    } else {
      context.lineTo(point.x, point.y);
    }
    context.lineTo(point.x, point.y);
    context.stroke();
    lastPointRef.current = point;
  }

  function stop(event?: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) {
      return;
    }
    drawingRef.current = false;
    lastPointRef.current = null;
    if (
      event &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const canvas = canvasRef.current;
    if (canvas) {
      const value = canvas.toDataURL("image/png");
      setSignatureData(value);
      hasSignatureRef.current = true;
      onSignatureChange?.(true);
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
    hasSignatureRef.current = false;
    onSignatureChange?.(false);
  }

  return (
    <div className="space-y-3">
      <SignatureStatus hasSignature={hasSignature} />
      <div
        className={`relative overflow-hidden rounded-md border-2 bg-white ${
          hasSignature ? "border-[#126b5f]" : "border-dashed border-[#c7a253]"
        }`}
      >
        {!hasSignature ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-gray-400">
            Draw your signature here
          </div>
        ) : null}
        <canvas
          aria-label="Draw your signature"
          className="block h-48 w-full touch-none select-none"
          onPointerCancel={stop}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={stop}
          ref={canvasRef}
        />
      </div>
      <input name="signatureData" type="hidden" value={signatureData} />
      <Button
        disabled={!hasSignature}
        onClick={clear}
        type="button"
        variant="outline"
      >
        <Eraser aria-hidden="true" className="size-4" />
        Clear and sign again
      </Button>
    </div>
  );
}
