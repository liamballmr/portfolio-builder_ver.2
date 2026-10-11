"use client";

import { useActionState } from "react";
import { signInAction } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(signInAction, undefined);
  return (
    <form className="admin-login__form" action={action}>
      <label>
        Email
        <input type="email" name="email" autoComplete="username" required />
      </label>
      <label>
        Password
        <input type="password" name="password" autoComplete="current-password" required />
      </label>
      {state?.error && <p className="admin-alert admin-alert--error" role="alert">{state.error}</p>}
      <button className="admin-primary-button" type="submit" disabled={pending}>
        {pending ? "SIGNING IN…" : "SIGN IN PRIVATELY"} <span>↗</span>
      </button>
      <p className="admin-login__fineprint">Public account registration is disabled. Use Liam’s pre-created account.</p>
    </form>
  );
}
