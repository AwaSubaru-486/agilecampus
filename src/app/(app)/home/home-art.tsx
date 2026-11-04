import { useId } from "react";
import type { FurnitureKind } from "@/lib/home-contract";

/** Architectural space and modular objects; independent of the pet renderer. */
export function FurnitureArt({ kind }: { kind: FurnitureKind }) {
  return <svg viewBox="0 0 100 110" fill="none" aria-hidden="true">
    <rect x="13" y="88" width="76" height="12" rx="6" fill="#1d353910" />
    {kind === "bench" && <><path d="M15 60H85V88H15Z" fill="#a7b9ba" /><rect x="12" y="53" width="76" height="17" rx="4" fill="#e5eded" /><rect x="17" y="32" width="66" height="24" rx="4" fill="#6f9191" /><path d="M21 40H79M21 48H79" stroke="#92aeab" strokeWidth="2" /><path d="M20 87V96M80 87V96" stroke="#567574" strokeWidth="5" /></>}
    {kind === "flowers" && <><rect x="15" y="56" width="70" height="37" rx="5" fill="#a9bfba" /><rect x="12" y="51" width="76" height="12" rx="4" fill="#d5e3dd" /><rect x="18" y="45" width="64" height="11" rx="4" fill="#3f7765" />{[26,43,60,76].map((x,i)=><g key={x}><path d={`M${x} 50V${27+i%2*7}`} stroke="#517e68" strokeWidth="3" /><rect x={x-6} y={19+i%2*7} width="12" height="13" rx="4" fill={i%2 ? "#adc5a0" : "#81ac97"} /></g>)}</>}
    {kind === "tree" && <><path d="M29 73H73L68 95H34Z" fill="#91aaa6" /><rect x="26" y="69" width="50" height="9" rx="3" fill="#bdcec6" /><path d="M51 73V34" stroke="#5b7d6d" strokeWidth="5" /><path d="M23 52L34 20L58 9L80 26L72 59L42 64Z" fill="#5e9782" /><path d="M34 20L42 64L23 52Z" fill="#77ac94" /><path d="M34 20L58 9L80 26L53 34Z" fill="#8bb69f" /></>}
    {kind === "lamp" && <><rect x="31" y="88" width="38" height="8" rx="3" fill="#a2b4b5" /><rect x="46" y="25" width="8" height="66" rx="2" fill="#5a737a" /><rect x="29" y="20" width="42" height="17" rx="4" fill="#365b65" /><rect x="32" y="34" width="36" height="4" rx="2" fill="#e5d9a7" /><path d="M33 39L20 86H80L67 39Z" fill="#e8dfb61c" /></>}
    {kind === "pond" && <><path d="M9 54L73 44L92 64L82 92L19 95L8 76Z" fill="#a4bcc0" /><path d="M14 52L76 45L90 62L79 84L21 88L12 72Z" fill="#d3e3e6" /><path d="M21 57L73 51L82 63L74 78L26 82L19 70Z" fill="#6aabaf" /><path d="M30 63L63 59M39 72L69 68" stroke="#b7d9d6" strokeWidth="2" /><rect x="17" y="84" width="62" height="4" rx="2" fill="#c6dcda" /></>}
    {kind === "bed" && <><rect x="13" y="59" width="74" height="36" rx="9" fill="#91a9b3" /><rect x="17" y="51" width="66" height="36" rx="9" fill="#d8e5e9" /><rect x="24" y="56" width="52" height="24" rx="8" fill="#f4f8fa" /><path d="M42 66H58M50 60V72" stroke="#a8bfca" strokeWidth="3" strokeLinecap="round" /><path d="M22 88H78" stroke="#b9ced4" strokeWidth="2" /></>}
    {kind === "picnic" && <><path d="M27 61V91M73 61V91" stroke="#81989c" strokeWidth="6" /><path d="M10 44L73 36L91 55L29 65Z" fill="#d8e5e5" /><path d="M10 44V52L29 73V65Z" fill="#a6c0be" /><path d="M29 65L91 55V63L29 73Z" fill="#8faaa9" /><rect x="58" y="39" width="12" height="10" rx="2" fill="#497f70" /><path d="M22 43L70 39" stroke="#f5f9f9" strokeWidth="2" /></>}
    {kind === "sign" && <><rect x="44" y="48" width="12" height="44" rx="2" fill="#a0b6b6" /><rect x="19" y="23" width="64" height="37" rx="5" fill="#365e67" /><path d="M30 35H61M30 44H51" stroke="#c3ded6" strokeWidth="3" strokeLinecap="round" /><path d="M67 37L73 42L67 47" stroke="#72c1a7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><rect x="32" y="89" width="36" height="6" rx="2" fill="#bacdcb" /></>}
  </svg>;
}

export function GardenBackdrop({ courtyard = false }: { courtyard?: boolean }) {
  const id = useId().replace(/:/g, "");
  return <svg data-backdrop viewBox="0 0 960 600" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-wall`} x1="480" y1="104" x2="480" y2="290" gradientUnits="userSpaceOnUse"><stop stopColor="#eaf1f4" /><stop offset="1" stopColor="#dce8e9" /></linearGradient>
      <linearGradient id={`${id}-floor`} x1="480" y1="269" x2="480" y2="557" gradientUnits="userSpaceOnUse"><stop stopColor="#f9fbfc" /><stop offset="1" stopColor="#e7f0ee" /></linearGradient>
      <linearGradient id={`${id}-glass`} x1="600" y1="120" x2="798" y2="260" gradientUnits="userSpaceOnUse"><stop stopColor="#a9c6cb" /><stop offset=".5" stopColor="#d2e3e3" /><stop offset="1" stopColor="#8fafb5" /></linearGradient>
      <pattern id={`${id}-tiles`} width="76" height="39" patternUnits="userSpaceOnUse"><path d="M76 0H0V39" stroke="#cbdcda" strokeWidth="1" opacity=".5" /></pattern>
    </defs>
    <rect x="62" y="563" width="836" height="12" rx="6" fill="#244d5510" />
    <path d="M60 277H900V539L881 563H80L60 539Z" fill="#bfcecf" />
    <rect x="60" y="277" width="840" height="274" rx="8" fill={`url(#${id}-floor)`} />
    <rect x="60" y="277" width="840" height="274" rx="8" fill={`url(#${id}-tiles)`} />
    <path d="M60 277V117Q60 105 72 105H888Q900 105 900 117V277Z" fill={`url(#${id}-wall)`} />
    <path d="M60 277H900" stroke="#b7cbcc" strokeWidth="3" />
    <rect x="78" y="120" width="804" height="10" rx="2" fill="#f8fbfc" />
    <path d="M355 135V268M506 135V268" stroke="#cadadb" strokeWidth="2" />
    <rect x="536" y="138" width="304" height="139" rx="4" fill="#56757c" />
    <rect x="543" y="145" width="290" height="130" rx="2" fill={`url(#${id}-glass)`} />
    <path d="M640 145V277M737 145V277" stroke="#63878b" strokeWidth="4" />
    <path d="M550 168L600 148M550 188L654 147M749 197L823 168" stroke="#edf7f7" strokeWidth="8" opacity=".3" />
    <rect x="657" y="200" width="5" height="30" rx="2" fill="#edf4f1" />
    <rect x="536" y="274" width="304" height="9" rx="2" fill="#90acad" />
    <rect x="111" y="156" width="184" height="67" rx="5" fill="#f8fbfc" stroke="#ccdcdc" />
    <rect x="128" y="173" width="11" height="31" rx="2" fill="#25836d" />
    <path d="M151 180H231M151 193H206" stroke="#b6caca" strokeWidth="5" strokeLinecap="round" />
    <rect x="112" y="247" width="183" height="32" rx="4" fill="#c4d5d1" />
    <rect x="120" y="235" width="167" height="17" rx="4" fill="#649582" />
    {Array.from({length:7},(_,i)=><path key={i} d={`M${128+i*23} 239L${122+i*23} 214L${136+i*23} 201L${145+i*23} 222L${140+i*23} 239Z`} fill={i%2 ? "#83ad97" : "#60937d"} />)}
    <rect x="81" y="316" width="15" height="194" rx="4" fill="#d0e0d8" />
    <rect x="864" y="316" width="15" height="194" rx="4" fill="#d0e0d8" />
    <path d="M85 537H875" stroke="#b2d0c3" strokeWidth="3" />
    {courtyard ? <><rect x="367" y="178" width="106" height="75" rx="7" fill="#c0d8cc" /><rect x="376" y="185" width="88" height="58" rx="4" fill="#d8e9df" /><path d="M390 204H450M390 218H435" stroke="#83ac97" strokeWidth="4" strokeLinecap="round" /></> : <><rect x="388" y="179" width="68" height="68" rx="4" fill="#f5f9fa" stroke="#c6d9d9" /><path d="M401 224L416 206L427 216L439 197" stroke="#85ada0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><circle cx="407" cy="194" r="5" fill="#b7d4c5" /></>}
    <path d="M98 293H862" stroke="#ffffff" strokeWidth="2" opacity=".8" />
  </svg>;
}
