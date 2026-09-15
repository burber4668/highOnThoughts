"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const MAX_CHARS = 280;
const TRIP_STORAGE_KEY = "hot-thoughts-trip";

const generateTripCode = () => String(Math.floor(1000 + Math.random() * 9000));

function formatRelativeTime(dateString) {
  const timestamp = new Date(dateString).getTime();
  const delta = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

function readStoredTrip() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TRIP_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function parseTripMessage(rawText, fallbackSender = "Trip System") {
  if (!rawText || typeof rawText !== "string") {
    return { sender: fallbackSender || "Trip System", content: "" };
  }

  const separatorIndex = rawText.indexOf("::");
  if (separatorIndex > 0) {
    const sender = rawText.slice(0, separatorIndex).trim();
    const content = rawText.slice(separatorIndex + 2).trim();
    return {
      sender: sender || fallbackSender || "Guest",
      content: content || rawText,
    };
  }

  if (/ joined the trip\.?$/i.test(rawText) || / left the trip\.?$/i.test(rawText)) {
    const match = rawText.match(/^(.*?)(?: joined the trip| left the trip)\.?$/i);
    if (match?.[1]) {
      return {
        sender: match[1].trim() || fallbackSender || "Guest",
        content: rawText,
      };
    }
  }

  return { sender: fallbackSender || "Trip System", content: rawText };
}

export default function Home() {
  const [thoughts, setThoughts] = useState([]);
  const [draft, setDraft] = useState("");
  const [sessionCode, setSessionCode] = useState(null);
  const [joinedCode, setJoinedCode] = useState(null);
  const [joinInput, setJoinInput] = useState("");
  const [joinActive, setJoinActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [likedIds, setLikedIds] = useState([]); // Track user's client-side likes local to session
  const [username, setUsername] = useState("");
  const [alterEgo, setAlterEgo] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [alterEgoInput, setAlterEgoInput] = useState("");
  const [pendingAction, setPendingAction] = useState(null);
  const [pendingAlterEgo, setPendingAlterEgo] = useState(false);
  const [hasSeenAlterEgoPrompt, setHasSeenAlterEgoPrompt] = useState(false);
  const [userId, setUserId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isMounted, setIsMounted] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ username: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authRetrySeconds, setAuthRetrySeconds] = useState(0);
  const [lastSignupEmail, setLastSignupEmail] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const syncProfileFromSession = async (session) => {
    if (!supabase) return;

    if (!session?.user) {
      setUserId(null);
      setProfile(null);
      setUsername("");
      setAlterEgo("");
      setUsernameInput("");
      setAlterEgoInput("");
      setIsAuthenticated(false);
      setAuthOpen(true);
      return;
    }

    let profileData = null;
    const { data, error: profileError } = await supabase
      .from("profiles")
      .select("id, username")
      .eq("id", session.user.id)
      .maybeSingle();

    if (profileError) {
      console.warn("Supabase profile lookup failed:", profileError.message);
    } else {
      profileData = data;
    }

    if (!profileData) {
      const usernameFromMeta = session.user.user_metadata?.username || session.user.email?.split("@")[0] || "User";
      const { error: insertError } = await supabase.from("profiles").insert({
        id: session.user.id,
        username: usernameFromMeta,
      });

      if (!insertError) {
        profileData = { id: session.user.id, username: usernameFromMeta };
      } else if (insertError.code !== "23505") {
        console.warn("Profile insert on signed-in session failed:", insertError.message);
      }
    }

    const nextUsername = (profileData?.username || session.user.user_metadata?.username || session.user.email?.split("@")[0] || "User").toLowerCase();
    const nextAlterEgo = (session.user.user_metadata?.alter_ego || nextUsername).toLowerCase();

    setUserId(session.user.id);
    setProfile(profileData || { id: session.user.id, username: nextUsername });
    setUsername(nextUsername);
    setAlterEgo(nextAlterEgo);
    setUsernameInput(nextAlterEgo);
    setAlterEgoInput(nextAlterEgo);
    setIsAuthenticated(true);
    setAuthOpen(false);
  };

  useEffect(() => {
    const stored = readStoredTrip();
    if (stored) {
      setSessionCode(stored.sessionCode ?? null);
      setJoinedCode(stored.joinedCode ?? null);
      setUsername(stored.username ?? "");
      setAlterEgo(stored.alterEgo ?? stored.username ?? "");
      setUsernameInput(stored.alterEgo ?? stored.username ?? "");
      setAlterEgoInput(stored.alterEgo ?? stored.username ?? "");
    }

    const bootstrapAuthSession = async () => {
      if (!supabase) return;

      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          console.warn("Supabase session check failed:", sessionError.message);
        }

        await syncProfileFromSession(session);
      } catch (err) {
        console.warn("Supabase auth bootstrap failed:", err);
      } finally {
        setIsMounted(true);
      }
    };

    const { data: authListener } = supabase
      ? supabase.auth.onAuthStateChange(async (event, session) => {
          if (event === "SIGNED_IN") {
            await syncProfileFromSession(session);
          }

          if (event === "SIGNED_OUT") {
            setUserId(null);
            setProfile(null);
            setUsername("");
            setAlterEgo("");
            setUsernameInput("");
            setAlterEgoInput("");
            setIsAuthenticated(false);
            setAuthOpen(true);
          }
        })
      : { data: null };

    bootstrapAuthSession();

    return () => {
      authListener?.subscription?.unsubscribe?.();
    };
  }, []);

  const inSession = joinedCode !== null;
  const canShare = inSession && draft.trim().length > 0;
  const remaining = MAX_CHARS - draft.length;
  const usernameReady = username.trim().length > 0;
  const displayName = (alterEgo || username || "Guest").trim();
  const guestLabel = displayName || (userId ? `${userId.slice(0, 8)}...` : "Guest");
  const tripParticipantCount = useMemo(() => {
    const uniqueNames = new Set();

    if (displayName) {
      uniqueNames.add(displayName);
    }

    thoughts.forEach((thought) => {
      const parsed = parseTripMessage(thought.text_content || "");

      if (thought.is_system || thought.system_event) {
        if (parsed.sender && parsed.sender !== "Trip System") {
          uniqueNames.add(parsed.sender);
        }
        return;
      }

      const candidate = parsed.sender || thought.nickname || thought.author || displayName || "Guest";
      if (candidate) {
        uniqueNames.add(candidate);
      }
    });

    return Math.max(1, uniqueNames.size);
  }, [displayName, thoughts]);

  // Persist code structures to localStorage for hot-reloads
  useEffect(() => {
    if (!isMounted) return;

    try {
      const state = { sessionCode, joinedCode, username, alterEgo };
      window.localStorage.setItem(TRIP_STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [isMounted, sessionCode, joinedCode, username, alterEgo]);

  // Fetch initial thoughts and subscribe to real-time changes
  useEffect(() => {
    if (!joinedCode || !supabase) {
      return;
    }

    // 1. Initial Fetch (Latest thoughts first)
    const fetchThoughts = async () => {
      try {
        const { data, error } = await supabase
          .from("thoughts")
          .select("*")
          .eq("party_code", joinedCode)
          .order("created_at", { ascending: false });

        if (!error && data) {
          setThoughts(
            data.map((item) => {
              const parsed = parseTripMessage(item.text_content || "");
              return {
                ...item,
                text_content: parsed.content || item.text_content,
                nickname: parsed.sender || item.nickname || item.author || displayName || "Guest",
                author: parsed.sender || item.nickname || item.author || displayName || "Guest",
              };
            })
          );
        }
      } catch (err) {
        console.warn("Supabase fetch thoughts failed:", err);
      }
    };

    fetchThoughts();

    // 2. Real-time Subscription - List tracking rule enforcement
    const channel = supabase
      .channel(`realtime-thoughts-${joinedCode}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "thoughts",
          filter: `party_code=eq.${joinedCode}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setThoughts((current) => {
              const exists = current.some((t) => t.id === payload.new.id);
              if (exists) return current;

              const parsed = parseTripMessage(payload.new.text_content || "");
              return [
                {
                  ...payload.new,
                  text_content: parsed.content || payload.new.text_content,
                  nickname: parsed.sender || payload.new.nickname || payload.new.author || displayName || "Guest",
                  author: parsed.sender || payload.new.nickname || payload.new.author || displayName || "Guest",
                },
                ...current,
              ];
            });
          } else if (payload.eventType === "UPDATE") {
            setThoughts((current) =>
              current.map((t) => (t.id === payload.new.id ? payload.new : t))
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [joinedCode]);

  const addSystemMessage = async (messageText) => {
    const senderLabel = displayName || username || "Guest";
    const systemMessage = {
      id: `system-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      text_content: `${senderLabel}::${messageText}`,
      created_at: new Date().toISOString(),
      likes: 0,
      nickname: senderLabel,
      author: senderLabel,
      is_system: true,
      system_event: true,
      user_id: null,
    };

    setThoughts((current) => [systemMessage, ...current]);

    if (!supabase || !joinedCode) return;

    try {
      const minimalPayload = {
        party_code: joinedCode,
        text_content: `${senderLabel}::${messageText}`,
        likes: 0,
        created_at: new Date().toISOString(),
      };

      await supabase.from("thoughts").insert([minimalPayload]);
    } catch (err) {
      console.warn("Supabase trip system message failed:", err);
    }
  };

  const handleStartTrip = async () => {
    const cleanedName = (alterEgo || username).trim();
    if (!cleanedName) {
      setPendingAction("start");
      setAlterEgoInput(alterEgo || username);
      setStatusMessage("");
      return;
    }

    const code = generateTripCode();
    setSessionCode(code);
    setJoinedCode(code);
    setJoinActive(false);
    setJoinInput("");

    await addSystemMessage(`${displayName || "Someone"} started the trip.`);

    let created = false;

    if (supabase) {
      try {
        const { error } = await supabase
          .from("parties")
          .insert([{ party_code: code }]);

        if (!error) {
          created = true;
        } else {
          console.warn("Supabase start trip failed:", error.message);
        }
      } catch (err) {
        console.warn("Supabase start trip exception:", err);
      }
    }

    setStatusMessage(
      created
        ? `Trip started. Share code ${code} to bring others into this session.`
        : `Trip started locally with code ${code}. Cloud sync is unavailable.`
    );
  };

  const handleJoinTrip = async () => {
    const cleanedName = (alterEgo || username).trim();
    if (!cleanedName) {
      setPendingAction("join");
      setAlterEgoInput(alterEgo || username);
      setJoinInput("");
      setStatusMessage("");
      return;
    }

    const normalized = joinInput.trim();
    if (!/^[0-9]{4}$/.test(normalized)) {
      setStatusMessage("Enter a valid 4-digit trip code.");
      return;
    }

    let foundRemote = false;
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("parties")
          .select("*")
          .eq("party_code", normalized)
          .maybeSingle();

        if (data && !error) {
          foundRemote = true;
        }
      } catch (err) {
        console.warn("Supabase join trip exception:", err);
      }
    }

    const localMatch = sessionCode === normalized;
    if (!foundRemote && !localMatch) {
      setStatusMessage(
        "That code doesn't match an active trip. If the trip was started locally, use the same browser session."
      );
      return;
    }

    setJoinedCode(normalized);
    setSessionCode(normalized);
    await addSystemMessage(`${displayName || "Someone"} joined the trip.`);
    setStatusMessage(`Joined trip ${normalized}. You can now share notes with this session.`);
    setJoinActive(false);
    setJoinInput("");
  };

  const handleShare = async () => {
    if (!canShare || draft.length > MAX_CHARS) return;

    const currentDraft = draft.trim();
    setDraft(""); // Reset text field smoothly immediately on submit

    const thoughtPayload = {
      id: Date.now(),
      text_content: `${displayName || "Guest"}::${currentDraft}`,
      created_at: new Date().toISOString(),
      likes: 0,
      nickname: displayName || "Guest",
      author: displayName || "Guest",
    };

    if (!supabase) {
      setThoughts((current) => [thoughtPayload, ...current]);
      setStatusMessage("Thought saved locally because cloud sync is unavailable.");
      return;
    }

    const safePayload = {
      party_code: joinedCode,
      text_content: `${displayName || "Guest"}::${currentDraft}`,
      likes: 0,
      created_at: new Date().toISOString(),
    };

    try {
      const { error } = await supabase.from("thoughts").insert([safePayload]);

      if (error) {
        console.warn("Supabase insert thought failed:", error.message || error);
        setStatusMessage("Couldn't upload thought. Please check connection.");
        setThoughts((current) => [thoughtPayload, ...current]);
      }
    } catch (err) {
      console.warn("Supabase share thought exception:", err);
      setStatusMessage("Couldn't upload thought. Please check connection.");
      setThoughts((current) => [thoughtPayload, ...current]);
    }
  };

  const toggleVibe = async (id, currentLikes) => {
    const isLiked = likedIds.includes(id);
    const nextLikes = currentLikes + (isLiked ? -1 : 1);

    setLikedIds((prev) =>
      isLiked ? prev.filter((item) => item !== id) : [...prev, id]
    );

    setThoughts((current) =>
      current.map((thought) =>
        thought.id === id ? { ...thought, likes: nextLikes } : thought
      )
    );

    if (!supabase) return;

    try {
      await supabase
        .from("thoughts")
        .update({ likes: nextLikes })
        .eq("id", id);
    } catch (err) {
      console.warn("Supabase toggle vibe exception:", err);
    }
  };

  const handleLeave = async () => {
    const departureMessage = `${displayName || "Someone"} left the trip.`;
    await addSystemMessage(departureMessage);
    setJoinedCode(null);
    setSessionCode(null);
    setThoughts([]);
    setStatusMessage("You left the trip. Start or join a new one to continue.");
    window.localStorage.removeItem(TRIP_STORAGE_KEY);
  };

  const submitUsername = () => {
    const trimmed = alterEgoInput.trim();
    if (!trimmed) {
      setStatusMessage("Who are you tonight? Enter your alter ego before continuing.");
      return;
    }

    setAlterEgo(trimmed);
    setAlterEgoInput(trimmed);

    if (pendingAction === "start") {
      setPendingAction(null);
      handleStartTrip();
      return;
    }

    if (pendingAction === "join") {
      setPendingAction(null);
      setJoinActive(true);
      setStatusMessage("");
    }
  };

  const saveAlterEgo = () => {
    const trimmed = alterEgoInput.trim() || username.trim();
    if (!trimmed) {
      setStatusMessage("Who are you tonight? Enter your alter ego first.");
      return;
    }

    setAlterEgo(trimmed);
    setAlterEgoInput(trimmed);
    setStatusMessage("Alter ego saved.");
    setPendingAlterEgo(false);
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    if (!alterEgo && !hasSeenAlterEgoPrompt) {
      setHasSeenAlterEgoPrompt(true);
      setPendingAlterEgo(true);
    }
  }, [isAuthenticated, alterEgo, hasSeenAlterEgoPrompt]);

  useEffect(() => {
    if (authRetrySeconds <= 0) return;

    const timer = setInterval(() => {
      setAuthRetrySeconds((current) => {
        if (current <= 1) {
          clearInterval(timer);
          setAuthError("");
          setStatusMessage("You can retry now.");
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [authRetrySeconds]);

  const handleResendConfirmation = async () => {
    if (!supabase || !lastSignupEmail) return;
    if (authRetrySeconds > 0) {
      setAuthError(`Please wait ${authRetrySeconds} seconds before resending the confirmation email.`);
      return;
    }

    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: lastSignupEmail,
      });

      if (error) {
        const message = error.message || "";
        if (/rate limit|too many requests|retry in/i.test(message)) {
          setAuthRetrySeconds(59);
          setAuthError("Email rate limit exceeded. Please wait 59 seconds before retrying.");
          return;
        }

        setAuthError(message);
        return;
      }

      setAuthRetrySeconds(59);
      setAuthError("");
      setStatusMessage("A fresh confirmation email has been sent. Check your inbox.");
    } catch (err) {
      console.warn("Supabase resend confirmation failed:", err);
      setAuthError("Unable to resend the confirmation email right now.");
    }
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    if (!supabase) {
      setAuthError("Supabase is not available.");
      return;
    }

    if (authRetrySeconds > 0) {
      setAuthError(`Too many requests. Please wait ${authRetrySeconds} seconds before trying again.`);
      return;
    }

    const usernameValue = authForm.username.trim().toLowerCase();
    const password = authForm.password;
    const fakeEmail = `${usernameValue.toLowerCase()}@neon.local`;

    if (!usernameValue) {
      setAuthError("Username is required.");
      return;
    }

    if (!password) {
      setAuthError("Password is required.");
      return;
    }

    try {
      const { data: existingProfile, error: profileLookupError } = await supabase
        .from("profiles")
        .select("id, username")
        .ilike("username", usernameValue)
        .maybeSingle();

      if (profileLookupError) {
        console.warn("Profile lookup failed:", profileLookupError.message);
      }

      if (authMode === "login") {
        if (!existingProfile) {
          setAuthError("No account found for this username. Create one first.");
          setAuthMode("signup");
          return;
        }

        const { data, error } = await supabase.auth.signInWithPassword({
          email: fakeEmail,
          password,
        });

        if (error) {
          const message = error.message || "";
          if (/rate limit|too many requests|retry in/i.test(message)) {
            setAuthRetrySeconds(59);
            setAuthError("Email rate limit exceeded. Please wait 59 seconds before retrying.");
            return;
          }

          if (/invalid login|incorrect|password/i.test(message)) {
            setAuthError("Incorrect password for this username");
            return;
          }

          setAuthError(message);
          return;
        }

        const signedInUser = data?.user;
        if (signedInUser) {
          setUserId(signedInUser.id);
          setUsername(usernameValue);
          setAlterEgo(usernameValue);
          setUsernameInput(usernameValue);
          setAlterEgoInput(usernameValue);
          setProfile({ id: signedInUser.id, username: usernameValue });
          setIsAuthenticated(true);
          setAuthOpen(false);
          setAuthError("");
          setStatusMessage("Logged in successfully.");
        }
        return;
      }

      if (existingProfile) {
        setAuthError("Username already exists. Please log in instead.");
        setAuthMode("login");
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: fakeEmail,
        password,
      });

      if (error) {
        const message = error.message || "";
        if (/rate limit|too many requests|retry in/i.test(message)) {
          setAuthRetrySeconds(59);
          setAuthError("Email rate limit exceeded. Please wait 59 seconds before retrying.");
          return;
        }

        setAuthError(message);
        return;
      }

      const newUser = data?.user;
      if (!newUser) {
        setAuthError("Unable to create your account right now.");
        return;
      }

      const { error: insertError } = await supabase.from("profiles").insert({
        id: newUser.id,
        username: usernameValue,
      });

      if (insertError) {
        console.warn("Profile insert failed:", insertError.message);
        setAuthError(insertError.message);
        return;
      }

      setUserId(newUser.id);
      setUsername(usernameValue);
      setAlterEgo(usernameValue);
      setUsernameInput(usernameValue);
      setAlterEgoInput(usernameValue);
      setProfile({ id: newUser.id, username: usernameValue });
      setIsAuthenticated(true);
      setAuthOpen(false);
      setPendingAlterEgo(true);
      setAuthError("");
      setStatusMessage("Account created. Choose your alter ego.");
    } catch (err) {
      console.warn("Supabase username auth failed:", err);
      setAuthError("Unable to continue with that username right now.");
    }
  };

  const handleLogout = async () => {
    if (!supabase) return;

    try {
      await supabase.auth.signOut();
      setUserId(null);
      setProfile(null);
      setUsername("");
      setAlterEgo("");
      setUsernameInput("");
      setAlterEgoInput("");
      setIsAuthenticated(false);
      setAuthForm({ username: "", password: "" });
      setAuthError("");
      setAuthOpen(true);
      setStatusMessage("You have been logged out. Please sign back in.");
    } catch (err) {
      console.warn("Supabase sign-out failed:", err);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        {authOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-[2rem] border border-emerald-500/20 bg-slate-900 p-6 shadow-2xl shadow-slate-950/60">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-300/70">Access</p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">
                    {authMode === "login" ? "Log in" : "Create account"}
                  </h2>
                </div>
              </div>

              <form onSubmit={handleAuthSubmit} className="space-y-4">
                <div>
                  <label htmlFor="account-username" className="mb-2 block text-sm text-slate-300">
                    Username
                  </label>
                  <input
                    id="account-username"
                    type="text"
                    value={authForm.username}
                    onChange={(event) =>
                      setAuthForm((current) => ({ ...current, username: event.target.value }))
                    }
                    placeholder="Your username"
                    className="w-full rounded-3xl border border-white/10 bg-slate-950/95 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400/80 focus:ring-2 focus:ring-emerald-400/20"
                  />
                </div>

                <div>
                  <label htmlFor="account-password" className="mb-2 block text-sm text-slate-300">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="account-password"
                      type={showPassword ? "text" : "password"}
                      value={authForm.password}
                      onChange={(event) =>
                        setAuthForm((current) => ({ ...current, password: event.target.value }))
                      }
                      placeholder="********"
                      className="w-full rounded-3xl border border-white/10 bg-slate-950/95 px-4 py-3 pr-12 text-sm text-slate-100 outline-none transition focus:border-emerald-400/80 focus:ring-2 focus:ring-emerald-400/20"
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute inset-y-0 right-3 flex items-center justify-center text-slate-400 transition hover:text-slate-200"
                    >
                      {showPassword ? "◉" : "◌"}
                    </button>
                  </div>
                </div>

                {statusMessage && !isAuthenticated && (
                  <p className="text-sm text-emerald-300">{statusMessage}</p>
                )}

                {authError && (
                  <p className="text-sm text-rose-300">
                    {authRetrySeconds > 0 ? `You can retry in ${authRetrySeconds} seconds.` : authError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={authRetrySeconds > 0}
                  className="w-full rounded-3xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {authRetrySeconds > 0 ? `Retry in ${authRetrySeconds}s` : authMode === "login" ? "Log in" : "Create account"}
                </button>
              </form>

              <div className="mt-4 text-center text-sm text-slate-400">
                {authMode === "login" ? "Need an account?" : "Already have an account?"}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode((current) => (current === "login" ? "signup" : "login"));
                    setAuthError("");
                    setStatusMessage("");
                  }}
                  className="font-semibold text-emerald-300 transition hover:text-emerald-200"
                >
                  {authMode === "login" ? "Create one" : "Log in"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {pendingAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[2rem] border border-emerald-500/20 bg-slate-900 p-6 shadow-2xl shadow-slate-950/60">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300/70">Enter your vibe</p>
            <h2 className="mt-3 text-2xl font-semibold text-white">Choose your alter ego</h2>
            <p className="mt-2 text-sm text-slate-400">
              Your username stays locked, but your alter ego is the name your trip friends will see when you post.
            </p>
            <input
              value={alterEgoInput}
              onChange={(event) => setAlterEgoInput(event.target.value)}
              placeholder={username || "Your alter ego"}
              className="mt-5 w-full rounded-3xl border border-white/10 bg-slate-950/95 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400/80 focus:ring-2 focus:ring-emerald-400/20"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submitUsername();
                }
              }}
              autoFocus
            />
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                className="flex-1 rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitUsername}
                className="flex-1 rounded-3xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:scale-[1.01]"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingAlterEgo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[2rem] border border-emerald-500/20 bg-slate-900 p-6 shadow-2xl shadow-slate-950/60">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300/70">Your identity</p>
            <h2 className="mt-3 text-2xl font-semibold text-white">Set your alter ego</h2>
            <p className="mt-2 text-sm text-slate-400">
              This is the name friends see on the trip feed. Your username stays locked and private.
            </p>
            <input
              value={alterEgoInput}
              onChange={(event) => setAlterEgoInput(event.target.value)}
              placeholder={username || "Your alter ego"}
              className="mt-5 w-full rounded-3xl border border-white/10 bg-slate-950/95 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400/80 focus:ring-2 focus:ring-emerald-400/20"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  saveAlterEgo();
                }
              }}
              autoFocus
            />
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setPendingAlterEgo(false);
                  setStatusMessage("You can update your alter ego anytime from the profile area.");
                }}
                className="flex-1 rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
              >
                Later
              </button>
              <button
                type="button"
                onClick={saveAlterEgo}
                className="flex-1 rounded-3xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:scale-[1.01]"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 rounded-[2rem] border border-emerald-500/10 bg-slate-950/85 p-6 shadow-[0_28px_70px_-45px_rgba(16,185,129,0.65)] backdrop-blur-xl">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-white">
                High on Thoughts
              </h1>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-3xl bg-emerald-500/10 ring-1 ring-emerald-400/20">
              <span className="text-lg text-emerald-300">🛸</span>
            </div>
          </div>
          <p className="text-sm leading-6 text-slate-400">
            Start a shared session with a 4-digit code, join your friends, and keep thoughts locked to the same trip.
          </p>
          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-emerald-500/15 bg-slate-900/80 p-3">
            <p className="text-sm text-slate-200">
              Logged in as: <span className="font-semibold text-emerald-300">{profile?.username || username || "User"}</span>
            </p>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-100 transition hover:bg-white/10"
            >
              Log Out
            </button>
          </div>
        </header>

        <div className="mb-6 rounded-[1.75rem] border border-emerald-500/10 bg-slate-900/90 p-4 shadow-xl shadow-slate-950/25 backdrop-blur-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">Your identity</p>
          <p className="mt-2 text-sm text-slate-200">
            Username: <span className="font-semibold text-emerald-300">{profile?.username || username || "User"}</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">Your username is locked. You can change your alter ego anytime.</p>
          <div className="mt-3 flex gap-3">
            <input
              value={alterEgoInput}
              onChange={(event) => setAlterEgoInput(event.target.value)}
              placeholder="Your alter ego"
              className="w-full rounded-3xl border border-white/10 bg-slate-950/95 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400/80 focus:ring-2 focus:ring-emerald-400/20"
            />
            <button
              type="button"
              onClick={saveAlterEgo}
              className="inline-flex items-center justify-center rounded-3xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
            >
              Save
            </button>
          </div>
        </div>

        {!joinedCode ? (
          <section className="mb-6 rounded-[2rem] border border-emerald-500/10 bg-slate-900/90 p-5 shadow-xl shadow-slate-950/25 backdrop-blur-sm">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">Trip controls</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Start a trip to generate a shareable code, or join a friend&apos;s trip to connect to the same note feed.
                </p>
              </div>
              <div className="rounded-3xl bg-white/5 px-4 py-3 text-sm text-emerald-200 ring-1 ring-emerald-300/10">
                Active: Waiting
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setPendingAction("start");
                  setAlterEgoInput(alterEgo || username);
                  setStatusMessage("");
                }}
                className="inline-flex items-center justify-center rounded-3xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:scale-[1.01]"
              >
                Start Trip
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingAction("join");
                  setAlterEgoInput(alterEgo || username);
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
                <p className="mt-3 text-sm text-emerald-200">
                  [{tripParticipantCount}] {tripParticipantCount === 1 ? "person is" : "people are"} tripping with you
                </p>
              </div>
            )}
          </section>
        ) : null}

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
                    {thoughts.map((thought) => {
                      const isVibed = likedIds.includes(thought.id);

                      if (thought.is_system || thought.system_event) {
                        const parsedSystem = parseTripMessage(
                          thought.text_content || "",
                          thought.nickname || thought.author || "Trip System"
                        );

                        return (
                          <div
                            key={thought.id}
                            className="rounded-[1.5rem] border border-emerald-500/15 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-100"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="font-semibold text-emerald-200">{parsedSystem.sender}</p>
                              <span className="text-[10px] uppercase tracking-[0.2em] text-emerald-300/80">
                                {formatRelativeTime(thought.created_at)}
                              </span>
                            </div>
                            <p className="mt-2 leading-6">{parsedSystem.content || thought.text_content}</p>
                          </div>
                        );
                      }

                      const parsedMessage = parseTripMessage(thought.text_content || "", thought.nickname || thought.author || displayName || "Guest");

                      return (
                        <article key={thought.id} className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-900/95 p-5 shadow-xl shadow-slate-950/20 transition hover:-translate-y-0.5 hover:shadow-[0_18px_65px_-35px_rgba(16,185,129,0.45)]">
                          <div className="mb-4 flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-200">{parsedMessage.sender || thought.nickname || thought.author || username || "Guest"}</p>
                              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{formatRelativeTime(thought.created_at)}</p>
                            </div>
                            <span className="rounded-full bg-slate-800/80 px-3 py-1 text-xs text-slate-400 ring-1 ring-white/5">
                              {thought.likes} vibes
                            </span>
                          </div>
                          <p className="mb-5 whitespace-pre-wrap text-base leading-7 text-slate-100">
                            {parsedMessage.content || thought.text_content}
                          </p>
                          <div className="flex flex-wrap gap-3 text-sm">
                            <button
                              type="button"
                              onClick={() => toggleVibe(thought.id, thought.likes)}
                              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 transition ${isVibed ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/25" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}
                            >
                              <span>{isVibed ? "💚" : "✨"}</span>
                              {isVibed ? "Vibed" : "Vibe"}
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-slate-300 transition hover:border-emerald-400/30 hover:bg-emerald-500/10"
                              onClick={() => {
                                if (typeof window !== "undefined") {
                                  navigator.clipboard.writeText(thought.text_content);
                                  alert("Copied thought text to clipboard!");
                                }
                              }}
                            >
                              <span>🔗</span>
                              Copy
                            </button>
                          </div>
                        </article>
                      );
                    })}
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