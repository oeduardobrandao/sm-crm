// Disconnect an Instagram account: drop its synced posts and saved comment
// analyses, then blank the token. Any failing step throws so the caller never
// reports success on a half-disconnected account.

// deno-lint-ignore no-explicit-any
type Svc = { from(table: string): any };

export async function disconnectAccount(svc: Svc, accountId: string): Promise<void> {
  const { error: postsErr } = await svc.from("instagram_posts").delete().eq("instagram_account_id", accountId);
  if (postsErr) throw new Error(postsErr.message);

  const { error: analysesErr } = await svc
    .from("instagram_comment_analyses")
    .delete()
    .eq("instagram_account_id", accountId);
  if (analysesErr) throw new Error(analysesErr.message);

  const { error: updateErr } = await svc
    .from("instagram_accounts")
    .update({
      encrypted_access_token: "",
      token_expires_at: new Date(0).toISOString(),
      authorization_status: "disconnected",
      last_synced_at: null,
    })
    .eq("id", accountId);
  if (updateErr) throw new Error(updateErr.message);
}
