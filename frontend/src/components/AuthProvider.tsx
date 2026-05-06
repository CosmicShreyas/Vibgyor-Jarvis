import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchMe,
  getGoogleLoginUrl,
  signInWithEmail,
  signUpWithEmail,
  verifyEmailSignUp,
  type AuthUser,
} from "@/lib/api";

const TOKEN_KEY = "optimus.auth.token";
const USER_KEY = "optimus.auth.user";

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  requestSignUpCode: (email: string, password: string) => Promise<{ expiresInSeconds: number }>;
  verifySignUpCode: (email: string, code: string) => Promise<void>;
  signOut: () => void;
  startGoogleSignIn: () => void;
  consumeToken: (token: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function persistSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const storedUser = localStorage.getItem(USER_KEY);

    if (!storedToken) {
      setLoading(false);
      return;
    }

    setToken(storedToken);
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser) as AuthUser);
      } catch {
        /* ignore */
      }
    }

    void fetchMe(storedToken)
      .then((nextUser) => {
        setUser(nextUser);
        persistSession(storedToken, nextUser);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const consumeToken = async (nextToken: string) => {
    const nextUser = await fetchMe(nextToken);
    persistSession(nextToken, nextUser);
    setToken(nextToken);
    setUser(nextUser);
  };

  const signIn = async (email: string, password: string) => {
    const session = await signInWithEmail(email, password);
    persistSession(session.access_token, session.user);
    setToken(session.access_token);
    setUser(session.user);
  };

  const requestSignUpCode = async (email: string, password: string) => {
    const response = await signUpWithEmail(email, password);
    return { expiresInSeconds: response.expires_in_seconds };
  };

  const verifySignUpCode = async (email: string, code: string) => {
    const session = await verifyEmailSignUp(email, code);
    persistSession(session.access_token, session.user);
    setToken(session.access_token);
    setUser(session.user);
  };

  const signOut = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      loading,
      signIn,
      requestSignUpCode,
      verifySignUpCode,
      signOut,
      startGoogleSignIn: () => {
        window.location.href = getGoogleLoginUrl();
      },
      consumeToken,
    }),
    [loading, token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
