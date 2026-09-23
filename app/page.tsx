import FootballGame from "@/components/football-game"

export default function Page() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-slate-950 to-slate-900 px-4 py-6">
      <FootballGame />
      <footer className="mt-6 text-center text-xs text-slate-500">
        Arcade soccer built with an HTML canvas physics engine. Best played with a keyboard.
      </footer>
    </main>
  )
}
