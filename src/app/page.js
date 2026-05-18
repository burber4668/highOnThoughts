"use client";

import { useEffect, useState } from "react";

const MAX_CHARS = 280;
const TRIP_STORAGE_KEY = "hot-thoughts-trip";

const generateTripCode = () => String(Math.floor(1000 + Math.random() * 9000));

function formatRelativeTime(timestamp) {
  const delta = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

export default function Home() {
  const [thoughts, setThoughts] = useState([]);
  const [draft, setDraft] = useState("");
  const [sessionCode, setSessionCode] = useState(null);
  const [joinedCode, setJoinedCode] = useState(null);
  const [joinInput, setJoinInput] = useState("");
  const [joinActive, setJoinActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem(TRIP_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed?.sessionCode) setSessionCode(parsed.sessionCode);
        if (parsed?.joinedCode) setJoinedCode(parsed.joinedCode);
        if (Array.isArray(parsed?.thoughts)) setThoughts(parsed.thoughts);
      } catch {
        window.localStorage.removeItem(TRIP_STORAGE_KEY);
      }
    }
  }, []);

  const inSession = joinedCode !== null;
  const canShare = inSession && draft.trim().length > 0;
  const remaining = MAX_CHARS - draft.length;

  const saveTripState = (tripState) => {
    window.localStorage.setItem(TRIP_STORAGE_KEY, JSON.stringify(tripState));
  };

  const handleStartTrip = () => {
    const code = generateTripCode();
    setSessionCode(code);
    setJoinedCode(code);
    setStatusMessage(`Trip started. Share code ${code} to bring others into this session.`);
    setJoinActive(false);
    setJoinInput("");
    saveTripState({ sessionCode: code, joinedCode: code, thoughts });
  };

  const handleJoinTrip = () => {
    const normalized = joinInput.trim();
    if (!/^[0-9]{4}$/.test(normalized)) {
      setStatusMessage("Enter a valid 4-digit trip code.");
      return;
    }
    const activeCode = sessionCode || (() => {
      const stored = window.localStorage.getItem(TRIP_STORAGE_KEY);
      if (!stored) return null;
      try {
        return JSON.parse(stored)?.sessionCode || null;
      } catch {
        return null;
      }
    })();

    if (!activeCode) {
      setStatusMessage("No active trip is available yet. Ask your friend to start one.");
      return;
    }
    if (normalized !== activeCode) {
      setStatusMessage("That code doesn't match the active trip.");
      return;
    }
    setJoinedCode(normalized);
    setStatusMessage(`Joined trip ${normalized}. You can now share notes with this session.`);
    setJoinActive(false);
    setJoinInput("");
    saveTripState({ sessionCode: activeCode, joinedCode: normalized, thoughts });
  };

  const handleShare = () => {
    if (!canShare || draft.length > MAX_CHARS) return;

    const nextThought = {
      id: Date.now(),
      text: draft.trim(),
      createdAt: Date.now(),
      likes: 0,
      liked: false,
    };

    setThoughts((current) => {
      const next = [nextThought, ...current];
      saveTripState({ sessionCode, joinedCode, thoughts: next });
      return next;
    });
    setDraft("");
  };

  const toggleVibe = (id) => {
    setThoughts((current) =>
      current.map((thought) => {
        if (thought.id !== id) return thought;
        const liked = !thought.liked;
        return {
          ...thought,
          liked,
          likes: thought.likes + (liked ? 1 : -1),
        };
      })
    );
  };

  const handleLeave = () => {
    setJoinedCode(null);
    setStatusMessage("You left the trip. Start or join a new one to continue.");
    const stored = window.localStorage.getItem(TRIP_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        window.localStorage.setItem(TRIP_STORAGE_KEY, JSON.stringify({
          ...parsed,
          joinedCode: null,
        }));
      } catch {
        window.localStorage.removeItem(TRIP_STORAGE_KEY);
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 rounded-[2rem] border border-emerald-500/10 bg-slate-950/85 p-6 shadow-[0_28px_70px_-45px_rgba(16,185,129,0.65)] backdrop-blur-xl">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.35em] text-emerald-300/70">high-on-thoughts</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                Neon Night Trips
              </h1>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-3xl bg-emerald-500/10 ring-1 ring-emerald-400/20">
              <span className="text-lg text-emerald-300">🛸</span>
            </div>
          </div>
          <p className="text-sm leading-6 text-slate-400">
            Start a shared session with a 4-digit code, join your friends, and keep thoughts locked to the same trip.
          </p>
        </header>

        <section className="mb-6 rounded-[2rem] border border-emerald-500/10 bg-slate-900/90 p-5 shadow-xl shadow-slate-950/25 backdrop-blur-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">Trip controls</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Start a trip to generate a shareable code, or join a friend&apos;s trip to connect to the same note feed.
              </p>
            </div>
            <div className="rounded-3xl bg-white/5 px-4 py-3 text-sm text-emerald-200 ring-1 ring-emerald-300/10">
              Active: {joinedCode ? "Connected" : "Waiting"}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={handleStartTrip}
              className="inline-flex items-center justify-center rounded-3xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:scale-[1.01]"
            >
              Start Trip
            </button>
            <button
              type="button"
              onClick={() => {
                setJoinActive((current) => !current);
                setStatusMessage("");
              }}
              className="inline-flex items-center justify-center rounded-3xl border border-emerald-500/20 bg-slate-950/80 px-4 py-3 text-sm font-semibold text-emerald-300 transition hover:bg-slate-900"
            >
              Join Trip
            </button>
          </div>

          {joinActive && (
            <div className="mt-4 rounded-3xl border border-emerald-500/20 bg-slate-950/90 p-4 shadow-inner shadow-emerald-500/5">
              <label htmlFor="joinCode" className="mb-2 block text-sm font-medium text-slate-300">
                Enter 4-digit trip code
              </label>
              <div className="flex gap-3">
                <input
                  id="joinCode"
                  value={joinInput}
                  onChange={(event) => setJoinInput(event.target.value)}
                  placeholder="1234"
                  className="w-full rounded-3xl border border-white/10 bg-slate-950/95 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400/80 focus:ring-2 focus:ring-emerald-400/20"
                />
                <button
                  type="button"
                  onClick={handleJoinTrip}
                  className="inline-flex items-center justify-center rounded-3xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                >
                  Connect
                </button>
              </div>
            </div>
          )}

          {statusMessage && (
            <p className="mt-4 text-sm text-emerald-300">{statusMessage}</p>
          )}

          {sessionCode && (
            <div className="mt-5 rounded-[1.75rem] border border-emerald-500/15 bg-slate-950/70 px-4 py-4 text-sm text-slate-300 ring-1 ring-emerald-500/10">
              <p className="font-semibold text-slate-100">Current trip code</p>
              <p className="mt-1 text-2xl tracking-[0.35em] text-emerald-300">{sessionCode}</p>
              <p className="mt-2 text-xs text-slate-500">Share this code with friends to join the same trip.</p>
            </div>
          )}
        </section>

        {inSession ? (
          <>
            <section className="mb-6 rounded-[2rem] border border-emerald-500/10 bg-slate-900/90 p-5 shadow-xl shadow-slate-950/20">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">Active session</p>
                  <p className="mt-2 text-sm text-slate-300">You are connected to trip {joinedCode}.</p>
                </div>
                <button
                  type="button"
                  onClick={handleLeave}
                  className="rounded-full bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200 transition hover:bg-white/10"
                >
                  Leave Trip
                </button>
              </div>
              <div className="mb-4 flex items-center gap-2 text-sm text-slate-400">
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                Shared notes are visible only to joined trip members.
              </div>
              <div className="rounded-[1.75rem] border border-white/10 bg-slate-950/95 p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <label htmlFor="thought" className="block text-sm font-medium text-slate-300">
                    Add a trip thought
                  </label>
                  <span className={`text-xs ${remaining < 0 ? "text-rose-400" : "text-slate-400"}`}>
                    {remaining} chars left
                  </span>
                </div>
                <textarea
                  id="thought"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={MAX_CHARS * 2}
                  rows={5}
                  className="w-full resize-none rounded-[1.75rem] border border-white/10 bg-slate-950/95 p-4 text-sm text-slate-100 outline-none transition focus:border-emerald-400/70 focus:ring-2 focus:ring-emerald-500/20"
                  placeholder="Type your trip thought..."
                />
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="rounded-full bg-white/5 px-4 py-2 text-xs text-slate-400 ring-1 ring-white/5">
                    Notes are shared with the active trip only.
                  </div>
                  <button
                    type="button"
                    onClick={handleShare}
                    disabled={!canShare || remaining < 0}
                    className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Share Thought
                  </button>
                </div>
              </div>
            </section>

            <main className="flex-1 overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/80 shadow-[0_30px_90px_-60px_rgba(16,185,129,0.65)]">
              <div className="border-b border-white/5 px-5 py-4">
                <h2 className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">
                  Trip feed
                </h2>
              </div>
              <div className="max-h-[62vh] overflow-y-auto p-5">
                {thoughts.length === 0 ? (
                  <div className="flex min-h-[240px] flex-col items-center justify-center rounded-[1.75rem] border border-dashed border-slate-700/80 bg-slate-900/70 p-8 text-center text-slate-400 shadow-inner shadow-slate-950/40">
                    <p className="mb-3 text-lg font-semibold text-slate-100">The feed is quiet.</p>
                    <p className="max-w-sm text-sm leading-6">
                      Once you add a thought, everyone in the same trip can see it here.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {thoughts.map((thought) => (
                      <article key={thought.id} className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-900/95 p-5 shadow-xl shadow-slate-950/20 transition hover:-translate-y-0.5 hover:shadow-[0_18px_65px_-35px_rgba(16,185,129,0.45)]">
                        <div className="mb-4 flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-200">trip mind</p>
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{formatRelativeTime(thought.createdAt)}</p>
                          </div>
                          <span className="rounded-full bg-slate-800/80 px-3 py-1 text-xs text-slate-400 ring-1 ring-white/5">
                            {thought.likes} vibes
                          </span>
                        </div>
                        <p className="mb-5 whitespace-pre-wrap text-base leading-7 text-slate-100">
                          {thought.text}
                        </p>
                        <div className="flex flex-wrap gap-3 text-sm">
                          <button
                            type="button"
                            onClick={() => toggleVibe(thought.id)}
                            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 transition ${thought.liked ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/25" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}
                          >
                            <span>{thought.liked ? "💚" : "✨"}</span>
                            {thought.liked ? "Vibed" : "Vibe"}
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-slate-300 transition hover:border-emerald-400/30 hover:bg-emerald-500/10"
                            onClick={() => {
                              /* placeholder for share action */
                            }}
                          >
                            <span>🔗</span>
                            Share
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </main>
          </>
        ) : (
          <section className="flex flex-1 flex-col items-center justify-center rounded-[2rem] border border-dashed border-emerald-500/20 bg-slate-900/80 p-8 text-center shadow-inner shadow-emerald-500/5">
            <p className="mb-3 text-lg font-semibold text-slate-100">You&apos;re not in a trip yet.</p>
            <p className="max-w-xs text-sm leading-6 text-slate-400">
              Start a trip to get a 4-digit code, or join a friend&apos;s trip to unlock the shared note feed.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
