import { useState, useEffect } from 'preact/hooks';

interface User {
  id: string;
  username: string;
  role: string;
  createdAt: string;
  bannedAt: string | null;
  ipAddress: string | null;
}

export default function UserList() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  async function fetchUsers() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchUsers(); }, []);

  async function toggleBan(userId: string, isBanned: boolean) {
    const action = isBanned ? 'unban' : 'ban';
    if (!confirm(`${action === 'ban' ? 'Ban' : 'Unban'} this user?`)) return;

    setActionLoading(userId);
    try {
      await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, userId }),
      });
      fetchUsers();
    } finally {
      setActionLoading(null);
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-CA', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  return (
    <div class="user-list">
      {loading && <p class="muted">Loading...</p>}
      {!loading && users.length === 0 && <p class="muted">No users found.</p>}
      {!loading && users.length > 0 && (
        <table class="admin-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} class={u.bannedAt ? 'row-banned' : ''}>
                <td>
                  {u.username}
                  {u.role === 'guest' && u.ipAddress && (
                    <span class="ip-hint" title={u.ipAddress}> (IP: {u.ipAddress})</span>
                  )}
                </td>
                <td>{u.role}</td>
                <td>{u.bannedAt ? 'Banned' : 'Active'}</td>
                <td>{formatDate(u.createdAt)}</td>
                <td>
                  {u.role !== 'admin' && (
                    <button
                      type="button"
                      class={`btn-small ${u.bannedAt ? '' : 'btn-danger'}`}
                      onClick={() => toggleBan(u.id, !!u.bannedAt)}
                      disabled={actionLoading === u.id}
                    >
                      {actionLoading === u.id ? '...' : u.bannedAt ? 'Unban' : 'Ban'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
