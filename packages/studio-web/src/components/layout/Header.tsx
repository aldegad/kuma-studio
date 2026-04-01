export function Header() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-stone-200 bg-white px-6">
      <h2 className="text-lg font-semibold text-stone-900">스튜디오</h2>
      <div className="flex items-center gap-4">
        <span className="text-sm text-stone-500">
          AI 팀이 일하는 모습을 지켜보세요
        </span>
      </div>
    </header>
  );
}
