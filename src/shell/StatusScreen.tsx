import { TitleBar } from "./TitleBar";

/** Loading and error screens keep the title bar: the window stays movable and closable. */
export function StatusScreen({ message }: { message: string }) {
  return (
    <div className="dp-ambient flex h-screen flex-col">
      <TitleBar leading={<span className="text-(length:--text-ui) font-medium text-dp-text">dummyPlane</span>} />
      <div className="grid flex-1 place-items-center text-sm text-dp-text-2">{message}</div>
    </div>
  );
}
