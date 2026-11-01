import type { FurnitureKind, HomePet } from "@/lib/home-contract";

/** Built-in companions for the first release. A custom pet renderer can replace this component. */
export function PetAvatar({ pet }: { pet: HomePet }) {
  const bunny = pet.kind === "bunny";
  const dog = pet.kind === "dog";
  const fur = bunny ? "#fff9ed" : dog ? "#d4a16e" : "#f2b16f";
  return <svg viewBox="0 0 100 112" fill="none" aria-hidden="true">
    <ellipse cx="50" cy="103" rx="30" ry="7" fill="#304d3620" />
    <path d="M71 82Q99 69 89 58Q81 54 80 65" stroke={fur} strokeWidth="11" strokeLinecap="round" />
    <ellipse cx="50" cy="79" rx="25" ry="23" fill={fur} />
    <ellipse cx="50" cy="83" rx="15" ry="16" fill="#fff8e9" />
    <path d={bunny ? "M32 43Q18 0 31 3Q43 6 43 40M56 40Q55 0 68 5Q80 9 67 44" : dog ? "M29 37Q7 27 15 64L32 59M69 37Q94 26 87 64L68 59" : "M24 46L23 18L44 34M57 34L77 19L78 47"} fill={fur} stroke={fur} strokeWidth="3" strokeLinejoin="round" />
    {bunny && <path d="M32 34L29 13M64 34L67 14" stroke="#e5afb0" strokeWidth="5" strokeLinecap="round" />}
    {!bunny && !dog && <path d="M28 36L27 26L36 34M65 34L73 27L73 39" fill="#dc8b84" />}
    <rect x="22" y="32" width="56" height="48" rx="24" fill={fur} />
    {!dog && !bunny && <path d="M43 34L45 41M52 33L52 40M61 34L59 41" stroke="#d58d50" strokeWidth="3" strokeLinecap="round" />}
    <ellipse cx="39" cy="56" rx="3" ry="4" fill="#3d393c" /><ellipse cx="62" cy="56" rx="3" ry="4" fill="#3d393c" />
    <circle cx="31" cy="64" r="5" fill="#ea959078" /><circle cx="70" cy="64" r="5" fill="#ea959078" />
    <path d="M47 62Q50 59 53 62L50 65Z" fill="#a76f6c" />
    <path d="M50 65Q45 72 42 66M50 65Q55 72 58 66" stroke="#755953" strokeWidth="1.7" strokeLinecap="round" />
    <ellipse cx="35" cy="98" rx="10" ry="5" fill={fur} /><ellipse cx="65" cy="98" rx="10" ry="5" fill={fur} />
    <path d="M41 78L49 73L58 78L50 84Z" fill="#709f8b" /><circle cx="50" cy="79" r="3" fill="#eed9a0" />
  </svg>;
}

export function FurnitureArt({ kind }: { kind: FurnitureKind }) {
  return <svg viewBox="0 0 100 110" fill="none" aria-hidden="true">
    <ellipse cx="50" cy="94" rx="38" ry="9" fill="#304d361a" />
    {kind === "bench" && <><path d="M25 69V93M76 69V93" stroke="#715841" strokeWidth="7" strokeLinecap="round" /><path d="M19 43L80 43L84 66H16Z" fill="#c58e61" /><path d="M18 51H82M18 60H83" stroke="#a77751" strokeWidth="2" /><path d="M14 66H86V79H14Z" fill="#daa471" /><path d="M13 79H86" stroke="#9a6b48" strokeWidth="4" /><path d="M18 57V73M82 57V73" stroke="#715841" strokeWidth="5" strokeLinecap="round" /></>}
    {kind === "flowers" && <><path d="M19 76H82L74 97H26Z" fill="#c99479" /><path d="M18 74H83V81H18Z" fill="#dfb097" />{[28, 49, 70].map((x, i) => <g key={x}><path d={`M${x} 75V${46 - i % 2 * 10}`} stroke="#6c9968" strokeWidth="4" /><ellipse cx={x - 7} cy="65" rx="9" ry="4" fill="#7ba674" transform={`rotate(25 ${x - 7} 65)`} /><circle cx={x} cy={45 - i % 2 * 10} r="12" fill={i === 1 ? "#f0d18a" : "#d994ae"} /><circle cx={x} cy={45 - i % 2 * 10} r="5" fill="#fff2c5" /></g>)}</>}
    {kind === "tree" && <><path d="M50 45V94" stroke="#aa805b" strokeWidth="12" strokeLinecap="round" /><path d="M50 74L34 58M50 65L65 47" stroke="#aa805b" strokeWidth="5" /><path d="M13 55Q2 39 18 25Q18 5 43 9Q63-5 76 16Q101 19 90 45Q98 68 73 72Q51 84 32 69Q15 73 13 55" fill="#79a580" /><path d="M18 39Q18 17 43 20" stroke="#9abc91" strokeWidth="8" strokeLinecap="round" /><circle cx="32" cy="47" r="6" fill="#e9ad86" /><circle cx="66" cy="30" r="6" fill="#e9ad86" /><circle cx="71" cy="58" r="5" fill="#efd091" /></>}
    {kind === "lamp" && <><path d="M50 30V94" stroke="#626d65" strokeWidth="6" /><path d="M36 95H64" stroke="#626d65" strokeWidth="6" strokeLinecap="round" /><circle cx="50" cy="32" r="25" fill="#ffe9a42e" /><path d="M34 18H66L62 45H38Z" fill="#f4d591" stroke="#6b7569" strokeWidth="3" /><path d="M32 18L50 7L68 18Z" fill="#6b7569" /><path d="M50 18V44" stroke="#bcaa7e" strokeWidth="2" /></>}
    {kind === "pond" && <><path d="M12 69Q-1 49 26 43Q47 28 70 45Q102 48 92 77Q79 99 48 94Q15 100 12 69" fill="#b4b5a0" /><path d="M17 67Q7 51 31 48Q48 36 68 50Q96 52 85 75Q74 91 49 87Q20 91 17 67" fill="#86bfbe" /><path d="M31 64Q45 58 59 65M47 77H71" stroke="#c7e5d8" strokeWidth="2" strokeLinecap="round" /><ellipse cx="69" cy="57" rx="12" ry="5" fill="#78a57e" /><circle cx="70" cy="54" r="4" fill="#edb5b8" /></>}
    {kind === "bed" && <><ellipse cx="50" cy="78" rx="39" ry="21" fill="#9d8fae" /><ellipse cx="50" cy="72" rx="34" ry="17" fill="#c4b8cb" /><ellipse cx="50" cy="73" rx="24" ry="11" fill="#eee4de" /><path d="M28 60Q24 36 38 41Q46 43 42 60M59 60Q54 37 68 42Q78 48 73 63" fill="#c4b8cb" /><path d="M42 75H58" stroke="#d8c5c3" strokeWidth="3" strokeLinecap="round" /></>}
    {kind === "picnic" && <><path d="M21 53L76 46L94 85L16 96L5 70Z" fill="#f0d2af" /><path d="M16 64L82 58M13 78L88 70M30 53L44 91M54 50L69 88" stroke="#d79b8c" strokeWidth="6" opacity=".6" /><path d="M52 65H77L73 82H56Z" fill="#b78b61" /><path d="M57 65Q58 48 70 55L73 65" stroke="#9f7854" strokeWidth="3" /><ellipse cx="35" cy="70" rx="10" ry="5" fill="#fff9e8" /><circle cx="34" cy="66" r="5" fill="#ddb57b" /></>}
    {kind === "sign" && <><path d="M48 40V95" stroke="#a6805f" strokeWidth="8" /><path d="M17 28L78 23L85 61L20 65Z" fill="#d7b78b" stroke="#ac8b65" strokeWidth="2" /><path d="M35 46Q46 31 55 44Q64 35 68 46Q69 54 54 59Q39 58 35 46" fill="#fff1ce" /><circle cx="25" cy="36" r="2" fill="#a6805f" /><circle cx="76" cy="53" r="2" fill="#a6805f" /></>}
  </svg>;
}

export function GardenBackdrop({ courtyard = false }: { courtyard?: boolean }) {
  return <svg data-backdrop viewBox="0 0 960 600" fill="none" aria-hidden="true">
    <ellipse cx="490" cy="537" rx="405" ry="34" fill="#49775e14" />
    <path d="M68 335Q110 214 343 234Q543 196 797 259Q924 293 899 425Q868 563 601 557L269 546Q65 530 51 420Q45 373 68 335" fill="#a6bd91" />
    <path d="M74 328Q116 222 345 244Q543 207 794 268Q912 302 886 418Q855 549 600 544L270 534Q78 519 64 414Q59 369 74 328" fill="#c7d5ac" />
    <path d="M138 415Q289 385 430 423Q565 462 746 421" stroke="#dfe2bd" strokeWidth="57" strokeLinecap="round" />
    <path d="M685 318Q666 370 616 405" stroke="#e5dfc0" strokeWidth="47" strokeLinecap="round" />
    {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => <g key={i} transform={`translate(${100 + i * 88} ${290 - Math.sin(i) * 10})`}><path d="M0 0V-42L6-50L12-42V0" fill="#f6edda" /><path d="M12-30H87M12-12H87" stroke="#e9dfc9" strokeWidth="7" /></g>)}
    <g transform="translate(593 112)">
      <ellipse cx="112" cy="221" rx="132" ry="20" fill="#69816222" />
      <path d="M9 95L112 31L218 95V212H9Z" fill="#f5e7cd" />
      <path d="M144 68L218 95V212L144 225Z" fill="#e2cdb0" />
      <path d="M-7 99L107 16L234 96L212 112L108 44L10 113Z" fill="#b87d72" />
      <path d="M12 89L107 28L214 94M32 89L108 41L190 93" stroke="#d39a87" strokeWidth="4" strokeLinecap="round" />
      <path d="M165 51V13H186V67" fill="#b99c85" /><path d="M160 13H190V22H160Z" fill="#d9bea1" />
      <rect x="73" y="122" width="55" height="94" rx="25" fill="#739a87" /><path d="M83 169H118M101 130V208" stroke="#96b3a0" strokeWidth="3" /><circle cx="116" cy="171" r="3" fill="#e8d3a0" />
      <path d="M25 124H57V166H25Z" fill="#c0d5cd" stroke="#d7b58b" strokeWidth="6" /><path d="M41 126V164M26 145H56" stroke="#fff0d6" strokeWidth="3" />
      <path d="M159 128H193V169H159Z" fill="#b0c7bc" stroke="#c9aa82" strokeWidth="5" /><path d="M176 130V167M161 148H192" stroke="#f4e4c8" strokeWidth="3" />
      <path d="M62 216H140L147 228H55Z" fill="#bda88a" /><path d="M51 228H151L158 239H45Z" fill="#d1be9e" />
      <ellipse cx="35" cy="198" rx="17" ry="9" fill="#789e79" /><path d="M22 198H49L45 219H26Z" fill="#c99378" /><circle cx="34" cy="185" r="13" fill="#8aad83" />
    </g>
    <g transform="translate(111 173)"><path d="M40 77V151" stroke="#a98c67" strokeWidth="15" /><path d="M41 118L19 89M42 105L64 75" stroke="#a98c67" strokeWidth="6" /><path d="M3 85Q-20 51 3 31Q3 1 39 8Q65-10 81 17Q110 26 94 58Q106 88 73 103Q38 118 3 85" fill="#83a78b" /><path d="M1 48Q0 20 33 24" stroke="#a1bb95" strokeWidth="11" strokeLinecap="round" /></g>
    <g transform="translate(805 226) scale(.65)"><path d="M40 77V151" stroke="#a98c67" strokeWidth="15" /><path d="M3 85Q-20 51 3 31Q3 1 39 8Q65-10 81 17Q110 26 94 58Q106 88 73 103Q38 118 3 85" fill="#93ac85" /></g>
    {[ [92, 402], [260, 282], [430, 520], [826, 462], [742, 507], [340, 317], [177, 493] ].map(([x,y], i) => <g key={i} transform={`translate(${x} ${y})`}><path d="M0 0L-3-7M1 0L5-9M2 0L8-4" stroke="#96ad7c" strokeWidth="2" strokeLinecap="round" />{i % 2 === 0 && <><circle cx="-4" cy="-10" r="3" fill="#f9e5b1" /><circle cx="8" cy="-10" r="3" fill="#eee6cb" /></>}</g>)}
    {courtyard && <g transform="translate(362 191)"><path d="M0 90V-8M174 90V-8M-8-8H182" stroke="#aa8b6e" strokeWidth="8" strokeLinecap="round" /><path d="M34-5V60M139-5V60" stroke="#d0b69a" strokeWidth="3" /><path d="M25 60H148L143 72H30Z" fill="#ba946a" /><path d="M0 9Q88-17 174 9" stroke="#7eaa8c" strokeWidth="7" />{[20, 50, 80, 110, 145].map(x => <circle key={x} cx={x} cy="6" r="4" fill="#f3dc9d" />)}</g>}
    <g fill="#fff" opacity=".65"><path d="M220 90Q200 75 217 62Q223 38 246 51Q273 41 280 62Q303 66 296 83Q265 95 220 90" /><path d="M438 57Q426 45 442 37Q451 20 466 31Q485 27 491 42Q508 44 501 55Z" /></g>
    <path d="M326 119Q335 110 344 119M355 110Q363 101 371 110" stroke="#879e8c" strokeWidth="2.5" strokeLinecap="round" />
  </svg>;
}
