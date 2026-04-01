interface AgentAvatarProps {
  name: string;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
};

export function AgentAvatar({ name, size = "md" }: AgentAvatarProps) {
  // For Korean names take the first character, for English take first letters of words
  const initials = /[\u3131-\uD79D]/.test(name)
    ? name.slice(0, 1)
    : name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);

  return (
    <div
      className={`flex items-center justify-center rounded-full bg-amber-100 font-bold text-amber-800 ${sizeClasses[size]}`}
    >
      {initials}
    </div>
  );
}
