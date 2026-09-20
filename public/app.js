const byId = (id) => document.getElementById(id);
const username = byId('username');
const room = byId('room');
const message = byId('message');
const joined = new Set();
const history = new Map();
const presence = new Map();
const typingUsers = new Map();
let ownId;
let typingRoom;
let lastTypingStart = 0;
let idleTimer;
let socket;
let identified = false;

function notice(text) {
  byId('notice').textContent = text;
}
function stopTyping() {
  clearTimeout(idleTimer);
  if (typingRoom && socket?.readyState === WebSocket.OPEN) {
    send('typing_stop', { roomId: typingRoom });
  }
  typingRoom = undefined;
  lastTypingStart = 0;
}
function renderTyping() {
  const names = [...(typingUsers.get(room.value)?.values() ?? [])].map(
    (user) => user.username,
  );
  byId('typing').textContent = names.length
    ? `${names.slice(0, 3).join(', ')}${names.length > 3 ? ' and others' : ''} ${names.length === 1 ? 'is' : 'are'} typing…`
    : '';
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
    ? `${users.length} online`
    : 'Join to see members';
  byId('status').classList.toggle('connected', identified);
  byId('members').replaceChildren(
    ...[...users]
      .sort((a, b) => a.username.localeCompare(b.username))
      .map((user) => {
        const li = document.createElement('li');
        const avatar = document.createElement('span');
        avatar.className = 'avatar';
        avatar.textContent = user.username.slice(0, 2).toUpperCase();
        const name = document.createElement('span');
        name.textContent =
          user.username + (user.connectionId === ownId ? ' (you)' : '');
        li.append(avatar, name);
        return li;
      }),
  );
  renderTyping();
}
function renderMessages() {
  const list = byId('messages');
  list.replaceChildren();
  if (!history.get(room.value)?.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    const title = document.createElement('h3');
    title.textContent = 'Every conversation starts with hello.';
    const description = document.createElement('p');
    description.textContent = joined.has(room.value)
      ? 'Be the first to send a message in this room.'
      : 'Connect and join a room to get the conversation going.';
    empty.append(title, description);
    list.append(empty);
  }
  for (const item of history.get(room.value) ?? []) {
    const li = document.createElement('li');
    li.className = item.user.connectionId === ownId ? 'message own' : 'message';
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
  typingUsers.clear();
  stopTyping();
  renderMessages();
  socket = new WebSocket(
    `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`,
  );
  byId('status').textContent = 'Connecting…';
  update();
  socket.addEventListener('message', (event) => {
    const { type, payload } = JSON.parse(event.data);
    if (type === 'welcome') {
      ownId = payload.connectionId;
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
      renderMessages();
    } else if (type === 'room_left') {
      joined.delete(payload.roomId);
      presence.delete(payload.roomId);
      typingUsers.delete(payload.roomId);
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
      typingUsers.get(payload.roomId)?.delete(payload.user.connectionId);
      const users = presence.get(payload.roomId) ?? [];
      presence.set(
        payload.roomId,
        users.filter((user) => user.connectionId !== payload.user.connectionId),
      );
    } else if (type === 'typing_start') {
      const users = typingUsers.get(payload.roomId) ?? new Map();
      users.set(payload.user.connectionId, payload.user);
      typingUsers.set(payload.roomId, users);
    } else if (type === 'typing_stop') {
      typingUsers.get(payload.roomId)?.delete(payload.user.connectionId);
    } else if (type === 'chat_message') {
      const items = history.get(payload.roomId) ?? [];
      items.push(payload);
      if (items.length > 200) items.shift();
      history.set(payload.roomId, items);
      if (payload.roomId === room.value) renderMessages();
    } else if (type === 'error') {
      notice(payload.message);
      if (!identified) socket.close(1000, 'Username rejected');
    }
    update();
  });
  socket.addEventListener('close', () => {
    stopTyping();
    typingUsers.clear();
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
  stopTyping();
  socket?.close(1000, 'User disconnected');
  notice('Disconnected. You can connect again.');
});
byId('join').addEventListener('click', () =>
  send('join_room', { roomId: room.value }),
);
byId('leave').addEventListener('click', () => {
  stopTyping();
  send('leave_room', { roomId: room.value });
});
room.addEventListener('change', () => {
  stopTyping();
  message.value = '';
  update();
  renderMessages();
});
byId('message-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!message.value.trim() || !joined.has(room.value)) return;
  if (send('chat_message', { roomId: room.value, message: message.value })) {
    stopTyping();
    message.value = '';
    message.focus();
  }
});
message.addEventListener('input', () => {
  if (!joined.has(room.value) || !message.value.trim()) {
    stopTyping();
    return;
  }
  const now = Date.now();
  if (!typingRoom || now - lastTypingStart >= 2000) {
    if (!send('typing_start', { roomId: room.value })) return;
    typingRoom = room.value;
    lastTypingStart = now;
  }
  clearTimeout(idleTimer);
  idleTimer = setTimeout(stopTyping, 1200);
});
message.addEventListener('blur', stopTyping);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopTyping();
});
update();
renderMessages();
