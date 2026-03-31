import { useOfficeStore } from "../../stores/use-office-store";
import { OfficeBackground } from "./OfficeBackground";
import { Character } from "./Character";
import { Furniture } from "./Furniture";
import { Whiteboard } from "./Whiteboard";

export function OfficeCanvas() {
  const scene = useOfficeStore((s) => s.scene);

  return (
    <div className="relative h-[600px] w-full overflow-hidden rounded-2xl border border-stone-200 bg-amber-50/50 shadow-sm">
      <OfficeBackground background={scene.background} />

      {scene.furniture.map((item) => (
        <Furniture key={item.id} furniture={item} />
      ))}

      {scene.characters.map((character) => (
        <Character key={character.id} character={character} />
      ))}

      <Whiteboard position={{ x: 400, y: 30 }} />
    </div>
  );
}
