const byId = (id) => document.getElementById(id);
const username = byId('username');
const room = byId('room');
const message = byId('message');
const joined = new Set();
const history = new Map();
const presence = new Map();
let socket;
let identified = false;

function notice(text) {
  byId('notice').textContent = text;
}
function update() {
  const active = socket && socket.readyState !== WebSocket.CLOSED;
  byId('connect').disabled = Boolean(active);
  byId('disconnect').disabled = !active;
  username.disabled = Boolean(active);
  room.disabled = !identified;
  byId('join').disabled = !identified || joined.has(room.value);
  byId('leave').disabled = !identified || !joined.has(room.value);
  message.disabled = !identified || !joined.has(room.value);
  byId('send').disabled = message.disabled;
  byId('memberships').textContent = joined.size
    ? `Joined: ${[...joined].map((id) => '#' + id).join(', ')}`
    : 'No rooms joined.';
  byId('room-title').textContent = identified
    ? `#${room.value}`
    : 'Choose a room';
  const users = presence.get(room.value) ?? [];
  byId('presence').textContent = users.length
    ? `${users.length} online · ${users.map((user) => user.username).join(', ')}`
    : 'No members';
}
function renderMessages() {
  const list = byId('messages');
  list.replaceChildren();
  for (const item of history.get(room.value) ?? []) {
    const li = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${item.user.username} · ${new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = item.message;
    li.append(meta, body);
    list.append(li);
  }
  list.scrollTop = list.scrollHeight;
}
function send(type, payload) {
  if (socket?.readyState !== WebSocket.OPEN) {
    notice('Connection is not open. Connect again.');
    return false;
  }
  socket.send(JSON.stringify({ type, payload }));
  return true;
}
byId('connect-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (socket && socket.readyState !== WebSocket.CLOSED) return;
  const name = username.value;
  joined.clear();
  history.clear();
  presence.clear();
  renderMessages();
  socket = new WebSocket(
    `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`,
  );
  byId('status').textContent = 'Connecting…';
  update();
  socket.addEventListener('message', (event) => {
    const { type, payload } = JSON.parse(event.data);
    if (type === 'welcome') {
      room.replaceChildren(
        ...payload.rooms.map((id) => {
          const option = document.createElement('option');
          option.value = id;
          option.textContent = '#' + id;
          return option;
        }),
      );
      send('set_username', { username: name });
    } else if (type === 'identified') {
      identified = true;
      byId('status').textContent = `Connected as ${payload.username}`;
      notice('Choose a room and click Join.');
    } else if (type === 'room_joined') {
      joined.add(payload.roomId);
      notice(`Joined #${payload.roomId}.`);
    } else if (type === 'room_left') {
      joined.delete(payload.roomId);
      presence.delete(payload.roomId);
      notice(`Left #${payload.roomId}.`);
    } else if (type === 'presence_snapshot') {
      presence.set(payload.roomId, payload.users);
    } else if (type === 'user_joined') {
      const users = presence.get(payload.roomId) ?? [];
      if (
        !users.some((user) => user.connectionId === payload.user.connectionId)
      ) {
        presence.set(payload.roomId, [...users, payload.user]);
      }
    } else if (type === 'user_left') {
      const users = presence.get(payload.roomId) ?? [];
      presence.set(
        payload.roomId,
        users.filter((user) => user.connectionId !== payload.user.connectionId),
      );
    } else if (type === 'chat_message') {
      const items = history.get(payload.roomId) ?? [];
      items.push(payload);
      if (items.length > 200) items.shift();
      history.set(payload.roomId, items);
      renderMessages();
    } else if (type === 'error') {
      notice(payload.message);
      if (!identified) socket.close(1000, 'Username rejected');
    }
    update();
  });
  socket.addEventListener('close', () => {
    identified = false;
    joined.clear();
    presence.clear();
    byId('status').textContent = 'Disconnected';
    update();
  });
  socket.addEventListener('error', () =>
    notice('Unable to connect. Check that the server is running.'),
  );
});
byId('disconnect').addEventListener('click', () => {
  socket?.close(1000, 'User disconnected');
  notice('Disconnected. You can connect again.');
});
byId('join').addEventListener('click', () =>
  send('join_room', { roomId: room.value }),
);
byId('leave').addEventListener('click', () =>
  send('leave_room', { roomId: room.value }),
);
room.addEventListener('change', () => {
  update();
  renderMessages();
});
byId('message-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!message.value.trim() || !joined.has(room.value)) return;
  if (send('chat_message', { roomId: room.value, message: message.value })) {
    message.value = '';
    message.focus();
  }
});
update();
