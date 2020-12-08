/*******************************************************************************
 * Configs, constraints, and constants
 ******************************************************************************/
const P2P_CONFIG = {
  iceCandidatePoolSize: 10,
  iceServers: [{
    urls: [
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
    ],
  }]
};
// Even lower quality settings than the "good enough" video quality settings
// recommended by youtu.be/X2gLy4QRK9k (which claims to be able to support up
// to 10 users in a naive mesh network)
const VIDEO_CONSTRAINTS = {
  // QVGA (Quarter VGA) settings
  width:     { ideal: 320 },
  height:    { ideal: 240 },
  // Maximum number of frames per second allowed
  frameRate: { min: 1, max: 15 },
  // Maximum number of bits per second allowed
  MAX_BIT_RATE: 180000,
  // Factor by which to scale down the video's resolution in each dimension
  DOWNSCALE_FACTOR: 1.2
};
// Copied from youtu.be/X2gLy4QRK9k
const AUDIO_CONSTRAINTS = {
  googEchoCancellation:  true,
  googAutoGainControl:   true,
  googNoiseSuppression:  true,
  googHighpassFilter:    true,
  googNoiseSuppression2: true,
  googEchoCancellation2: true,
  googAutoGainControl2:  true
};
const PROXIMITY = {
  NEAREST:  2,
  NEAR:     4,
  FAR:      6,
  FARTHEST: 8
};
const VOLUME = {
  NEAREST:  1.0,
  NEAR:     0.5,
  FAR:      0.1,
  FARTHEST: 0.0
};
const COLOR = { // www.w3schools.com/colors/colors_picker.asp?colorhex=4682B4
  NEAREST:     '#a4c2db', // 75%
  NEAR:        '#6d9dc5', // 60%
  FAR:         '#4178a4', // 45%
  FARTHEST:    '#2c506d', // 30%
  TOAST_JOIN:  'rgba(220, 255, 210, 0.9)', // Green
  TOAST_LEAVE: 'rgba(255, 220, 220, 0.9)'  // Red
};
// Responses for creating or joining a room
const RESPONSE = {
  SUCCESS: 0,
  ROOM_DOESNT_EXIST_ERROR: 1,
  ROOM_ALREADY_EXISTS_ERROR: 2
};
const NUM_ROWS = 6;  // Number of rows in the video tile grid
const NUM_COLS = 13; // Number of cols in the video tile grid

/*******************************************************************************
 * Global variables
 ******************************************************************************/
let roomsCollection = null;
let roomId = null;
let roomName = null;
let videoGrid = null;
let videoTileGrid = null;
let localUserId = null;
let localUserName = null;
let localStream = null;
let allCoordinates = {};
let peerConnections = {};
let remoteStreams = {};
let nextToastNum = 0;

/*******************************************************************************
 * Just a shortcut helper function to query select DOM elements.
 ******************************************************************************/
function _dom(querySelector) {
  return document.querySelector(querySelector);
}

/*******************************************************************************
 * Returns true if the video tile specified by the given coordinates is
 * available (not currently occupied).
 ******************************************************************************/
function _isTileAvailable({row: pRow, col: pCol}) {
  for (let userId in allCoordinates) {
    const {row: eRow, col: eCol} = allCoordinates[userId];
    if (pRow === eRow && pCol === eCol) return false;
  }
  return true;
}

/*******************************************************************************
 * Returns the first available tile based on the list of given userCoordinates
 * doc snapshots.
 ******************************************************************************/
function _getAvailableTile(userCoordinates) {
  for (let i in userCoordinates) {
    const snapshot = userCoordinates[i];
    const userId = snapshot.id.substring(0, snapshot.id.length - 11);
    allCoordinates[userId] = snapshot.data();
  }

  // Find the first available tile
  for (let r = 0; r < NUM_ROWS; r++) {
    for (let c = 0; c < NUM_COLS; c++) {
      const coordinates = {row: r, col: c}
      if (_isTileAvailable(coordinates)) {
        return coordinates;
      }
    }
  } return null;
}

/*******************************************************************************
 * Downscale the video resolution and bitrate before sending the local user's
 * video track to this peer.
 ******************************************************************************/
function _downscaleVideo(peerConnection) {
  const videoSender = peerConnection.getSenders().find(
    s => s.track.kind === 'video');
  const params = videoSender.getParameters();
  if (!params.encodings) { params.encodings = [{}]; }
  params.encodings[0].maxBitrate = VIDEO_CONSTRAINTS.MAX_BIT_RATE;
  params.encodings[0].scaleResolutionDownBy =
    VIDEO_CONSTRAINTS.DOWNSCALE_FACTOR;
  videoSender.setParameters(params);
}

/*******************************************************************************
 * Return a new SDP that limits video bandwidth by setting its bitrate.
 * Modified from https://webrtchacks.com/limit-webrtc-bandwidth-sdp/
 ******************************************************************************/
function _setBitrateLimit(sdp) {
  let lines = sdp.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('m=video')) {
      console.log('Setting the bitrate of this SDP to ' +
        `${VIDEO_CONSTRAINTS.MAX_BIT_RATE} per second`);

      // Pass the m line
      let line = i + 1;

      // Skip i and c lines
      while (lines[line].startsWith('i=') || lines[line].startsWith('c=')) {
        line++;
      }

      // If we're on a b line, replace it
      if (lines[line].startsWith('b')) {
        lines[line] = `b=AS:${VIDEO_CONSTRAINTS.MAX_BIT_RATE/1000}`;
        return lines.join('\n');
      }

      // Add a new b line
      let newLines = lines.slice(0, line);
      newLines.push(`b=AS:${VIDEO_CONSTRAINTS.MAX_BIT_RATE/1000}`);
      newLines = newLines.concat(lines.slice(line, lines.length));
      return newLines.join('\n')
    }
  }

  console.log('Unable to set the bitrate of this SDP (missing m=video line)');
  return sdp;
}

/*******************************************************************************
 * Set the volume and color of each video in the grid based on its proximity to
 * the local user's current location.
 ******************************************************************************/
function _setVideoGridVolumeAndColor({row: localRow, col: localCol}) {
  for (let r = 0; r < NUM_ROWS; r++) {
    for (let c = 0; c < NUM_COLS; c++) {
      const dr = Math.abs(localRow - r);
      const dc = Math.abs(localCol - c);
      let proximityBasedColor;
      let proximityBasedVolume;
      if (dr < PROXIMITY.NEAREST && dc < PROXIMITY.NEAREST) {
        proximityBasedColor = COLOR.NEAREST;
        proximityBasedVolume = VOLUME.NEAREST;
      } else if (dr < PROXIMITY.NEAR && dc < PROXIMITY.NEAR) {
        proximityBasedColor = COLOR.NEAR;
        proximityBasedVolume = VOLUME.NEAR;
      } else if (dr < PROXIMITY.FAR && dc < PROXIMITY.FAR) {
        proximityBasedColor = COLOR.FAR;
        proximityBasedVolume = VOLUME.FAR;
      } else {
        proximityBasedColor = COLOR.FARTHEST;
        proximityBasedVolume = VOLUME.FARTHEST;
      }
      videoTileGrid[r][c].style.background = proximityBasedColor;
      videoGrid[r][c].volume = proximityBasedVolume;
    }
  }
}

/*******************************************************************************
 * Update the local user's location on the tile grid.
 ******************************************************************************/
function _moveVideoTileTo(row, col) {
  const coordinates = {row: row, col: col};
  if (row < 0 || row >= NUM_ROWS || col < 0 || col >= NUM_COLS) {
    console.log(`Tile {row: ${row}, col: ${col}} is out of bounds`);
  } else if (_isTileAvailable(coordinates)) {
    _doUserMove(coordinates);
  } else {
    console.log(`Tile {row: ${row}, col: ${col}} is already occupied`);
  }
}

/*******************************************************************************
 * Add a Bootstrap toast component with the given message.
 ******************************************************************************/
function _addToast(toastMessage, toastColor) {
  const toastNum = nextToastNum;
  nextToastNum += 1;

  // Create Bootstrap toast component
  const toast = document.createElement('div');
  toast.setAttribute('class', 'toast');
  toast.setAttribute('id', `toast${toastNum}`);
  toast.setAttribute('role', 'alert');
  toast.setAttribute('data-delay', '2000'); // Fade after 2 seconds
  toast.style.background = toastColor;
  toast.style.fontWeight = 'bold';
  toast.innerHTML = `<div class="toast-body">${toastMessage}</div>`;

  // Add to the toast container and show
  _dom('#toastContainer').appendChild(toast);
  $(`#toast${toastNum}`).toast('show');
}

/*******************************************************************************
 * Initialize the grid of video elements, each inside a video tile.
 ******************************************************************************/
function _initializeVideoGrid() {
  console.log('_initializeVideoGrid()');

  // Create the grid of videos
  videoGrid = [];
  videoTileGrid = [];
  for (let i = 0; i < NUM_ROWS; i++) {
    videoGrid[i] = new Array(NUM_COLS);
    videoTileGrid[i] = new Array(NUM_COLS);
  }

  const videoTileGridDiv = _dom('#videoTileGrid');
  for (let r = 0; r < NUM_ROWS; r++) {
    for (let c = 0; c < NUM_COLS; c++) {
      // Create a 'Move here' overlay.
      const moveHere = document.createElement('div');
      moveHere.setAttribute('class', 'moveHere');
      moveHere.innerHTML = '<div style="margin: auto;">Move<br>here</div>';

      // Create a video tile
      const videoTile = document.createElement('div');
      videoTile.setAttribute('class', 'videoTile');
      videoTile.onclick = (() => {
        const _r = r; const _c = c; const _moveHere = moveHere; // Closure vars
        return () => {
          _moveHere.style.display = 'none';
          _moveVideoTileTo(_r, _c)
        };
      })();

      // Display the "Move here" overlay on hover.
      videoTile.onmouseenter = (() => {
        const _r = r; const _c = c; const _moveHere = moveHere; // Closure vars
        return () => {
          if (videoGrid[_r][_c].srcObject === null) {
            _moveHere.style.display = 'flex';
          }
        };
      })();
      videoTile.onmouseleave = (() => {
        const _moveHere = moveHere; // Closure vars
        return () => _moveHere.style.display = 'none';
      })();

      // Create a video element
      const video = document.createElement('video');
      video.autoplay = true;
      video.playsinline = true;

      // Put it all together
      videoGrid[r][c] = video;
      videoTileGrid[r][c] = videoTile;
      videoTile.appendChild(video);
      videoTile.appendChild(moveHere);
      videoTileGridDiv.appendChild(videoTile);
    }
  }

  // Listen to arrow key presses to move the local user's coordinates.
  document.onkeydown = (e) => {
    const {row, col} = allCoordinates[localUserId];

    switch (e.code) {
      case 'ArrowUp':    _moveVideoTileTo(row - 1, col); break;
      case 'ArrowDown':  _moveVideoTileTo(row + 1, col); break;
      case 'ArrowLeft':  _moveVideoTileTo(row, col - 1); break;
      case 'ArrowRight': _moveVideoTileTo(row, col + 1); break;
    }
  };
}

/*******************************************************************************
 * Create a peer connection between the local and remote users.
 ******************************************************************************/
function _createPeerConnection(roomDoc, p2pDoc, localUserId, remoteUserId) {
  console.log(`_createPeerConnection(${remoteUserId})`);

  // (1a) Send in local stream through a new peer connection
  const peerConnection = new RTCPeerConnection(P2P_CONFIG);
  peerConnections[`to${remoteUserId}`] = peerConnection;
  localStream.getTracks().forEach(t => { 
    peerConnection.addTrack(t, localStream);
  });

  // (1b) Listen for remote stream through the peer connection
  const remoteStream = new MediaStream();
  remoteStreams[remoteUserId] = remoteStream;
  peerConnection.ontrack = e => {
    e.streams[0].getTracks().forEach(t => {remoteStream.addTrack(t);});
  };

  // (1c) Add the remote user's video stream to the correct tile
  roomDoc.collection('userSettings')
    .doc(`${remoteUserId}coordinates`).get().then(snapshot => {
      const remoteCoords = snapshot.data();
      allCoordinates[remoteUserId] = remoteCoords;
      videoGrid[remoteCoords.row][remoteCoords.col].srcObject = remoteStream;
  });

  // (2a) Add local ICE candidates
  const candidates = p2pDoc.collection(`${localUserId}candidates`);
  peerConnection.onicecandidate = e => {
    if (e.candidate) { candidates.add(e.candidate.toJSON()); }
  };

  // (2b) Listen for remote ICE candidates
  p2pDoc.collection(`${remoteUserId}candidates`).onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        peerConnection.addIceCandidate(
          new RTCIceCandidate(change.doc.data()));
      }
    });
  });

  // (3) Listen for closure of the peer connection.
  peerConnection.onconnectionstatechange = e => {
    switch (peerConnection.connectionState) {
      // This allows us to gracefully remove the remote user if they leave the
      // call by refreshing the page or exiting their browser tab/window,
      // instead of clicking their "Leave Room" button.
      case 'disconnected':
      case 'failed':
      case 'closed':
        // A user has exited the room.
        if (allCoordinates[remoteUserId]) {
          _onUserExit(roomDoc, remoteUserId);
        }
    }
  };

  return peerConnection;
}

/*******************************************************************************
 * Respond to the given remote user joining the call.
 ******************************************************************************/
async function _onUserJoin(roomDoc, p2pDoc, remoteUserId) {
  console.log(`_onUserJoin(${remoteUserId})`);

  // Display a brief toast notification that this user joined the call
  const names = await roomDoc.collection('userSettings').doc('userNames').get();
  const remoteUserName = names.data()[remoteUserId];
  _addToast(`${remoteUserName} joined the call!`, COLOR.TOAST_JOIN);

  const peerConnection =
    _createPeerConnection(roomDoc, p2pDoc, localUserId, remoteUserId);

  // Receive the offer
  const snapshot = await p2pDoc.get();
  const description = new RTCSessionDescription(snapshot.data().offer);
  peerConnection.setRemoteDescription(description);

  // Send a response
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  answer.sdp = _setBitrateLimit(answer.sdp);
  p2pDoc.update({answer: { type: answer.type, sdp: answer.sdp }});

  _downscaleVideo(peerConnection);
}

/*******************************************************************************
 * Respond to the given remote user moving video tile locations.
 ******************************************************************************/
function _onUserMove(roomDoc, newCoordinates, remoteUserId) {
  const {row: newRow, col: newCol} = newCoordinates;
  console.log(`_onUserMove(${remoteUserId}, {row: ${newRow}, col: ${newCol})}`);

  // Update all coordinates
  const {row: oldRow, col: oldCol} = allCoordinates[remoteUserId];
  allCoordinates[remoteUserId] = newCoordinates;

  // Update the remote user's video position
  videoGrid[oldRow][oldCol].srcObject = null;
  videoGrid[newRow][newCol].srcObject = remoteStreams[remoteUserId];

  _setVideoGridVolumeAndColor(allCoordinates[localUserId]);
}

/*******************************************************************************
 * Respond to the given remote user exiting the call.
 ******************************************************************************/
async function _onUserExit(roomDoc, remoteUserId) {
  console.log(`_onUserExit(${remoteUserId})`);

  // Display a brief toast notification that this user left the call
  const names = await roomDoc.collection('userSettings').doc('userNames').get();
  const remoteUserName = names.data()[remoteUserId];
  _addToast(`${remoteUserName} left the call`, COLOR.TOAST_LEAVE);

  // Make sure the remote user's coordinates and IDs have been deleted.
  await roomDoc.collection('userSettings')
    .doc(`${remoteUserId}coordinates`).delete();
  roomDoc.update({
    userIds: firebase.firestore.FieldValue.arrayRemove(remoteUserId),
  });

  // Remove the remote video.
  const remoteCoordinates = allCoordinates[remoteUserId];
  delete allCoordinates[remoteUserId];
  if (remoteCoordinates) {
    videoGrid[remoteCoordinates.row][remoteCoordinates.col].srcObject = null;
  }

  // Stop the remote stream.
  if (remoteStreams[remoteUserId]) {
    remoteStreams[remoteUserId].getTracks().forEach(t => t.stop());
    delete remoteStreams[remoteUserId];
  }

  // Close the peer connection.
  if (peerConnections[remoteUserId]) {
    peerConnections[remoteUserId].close();
    delete peerConnections[remoteUserId];
  }
}

/*******************************************************************************
 * Initiate a connection with the given user in the call.
 ******************************************************************************/
async function _doUserJoin(roomDoc, p2pDoc, remoteUserId) {
  console.log(`_doUserJoin(${remoteUserId})`);

  const peerConnection =
    _createPeerConnection(roomDoc, p2pDoc, localUserId, remoteUserId);

  // Listen for a response
  p2pDoc.onSnapshot(snapshot => {
    const data = snapshot.data();
    if (!peerConnection.currentRemoteDescription && data && data.answer) {
      peerConnection.setRemoteDescription(
        new RTCSessionDescription(data.answer));
    }
  });

  // Initiate an offer
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  offer.sdp = _setBitrateLimit(offer.sdp);
  p2pDoc.set({offer: { type: offer.type, sdp: offer.sdp }});

  _downscaleVideo(peerConnection);
}

/*******************************************************************************
 * Move video tile locations, and broadcast the update to all users in the call.
 ******************************************************************************/
function _doUserMove(newCoordinates) {
  const {row: newRow, col: newCol} = newCoordinates;
  console.log(`_doUserMove({row: ${newRow}, col: ${newCol})}`);

  // Update coordinates
  const {row: oldRow, col: oldCol} = allCoordinates[localUserId];
  allCoordinates[localUserId] = newCoordinates;
  roomsCollection.doc(roomId).collection('userSettings')
    .doc(`${localUserId}coordinates`).update(newCoordinates);

  // Update the local user's video position
  const oldVideo = videoGrid[oldRow][oldCol]
  oldVideo.srcObject = null;
  oldVideo.muted = false;
  oldVideo.setAttribute('id', '');
  const newVideo = videoGrid[newRow][newCol];
  newVideo.srcObject = localStream;
  newVideo.muted = true;
  newVideo.setAttribute('id', 'localVideo');

  _setVideoGridVolumeAndColor(newCoordinates);
}

/*******************************************************************************
 * Terminate the connections with all the users in the call.
 ******************************************************************************/
function _doUserExit() {
  console.log('_doUserExit()');

  // Stop the local stream.
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
  }

  // Stop all remote streams.
  for (let id in remoteStreams) {
    if (remoteStreams[id]) {
      remoteStreams[id].getTracks().forEach(t => t.stop());
    }
  }

  // Close all peer connections.
  for (let id in peerConnections) {
    if (peerConnections[id]) {
      peerConnections[id].close();
    }
  }
}

/*******************************************************************************
 * Wait for other user(s) to join the room, move tiles, or leave the room.
 ******************************************************************************/
function _waitForOtherUsers(roomDoc) {
  console.log('_waitForOtherUsers()');

  roomDoc.collection(`from${localUserId}`).onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        // A user has joined the room
        const remoteUserId = change.doc.id.substring(2);
        _onUserJoin(roomDoc, change.doc.ref, remoteUserId);
      }
    });
  });

  roomDoc.collection(`userSettings`).onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'modified') {
        const docId = change.doc.id;
        if (docId.includes('coordinates')) {
          const remoteUserId = docId.substring(0, docId.length - 11);
          if (remoteUserId != localUserId) {
            // A user moved the location of their video tile
            _onUserMove(roomDoc, change.doc.data(), remoteUserId);
          }
        }
      }
    });
  });
}

/*******************************************************************************
 * Create a new room (first user on the video call).
 ******************************************************************************/
async function _createRoom(roomName) {
  console.log(`_createRoom(${roomName})`);

  // Verify that this room name isn't being used already
  roomsCollection = await firebase.firestore().collection('rooms');
  const roomIdsDoc = roomsCollection.doc('roomIds');
  const roomIds = await roomIdsDoc.get();
  if (roomIds.data()) {
    const roomNameToId = roomIds.data().roomNameToId;
    if (Object.keys(roomNameToId).includes(roomName)) {
      return RESPONSE.ROOM_ALREADY_EXISTS_ERROR;
    }
  }

  // Set the room ID
  if (!roomIds.data()) {
    roomId = 'ROOM0';
    roomIdsDoc.set({ nextRoomNum: 1, roomNameToId: { [roomName]: roomId } });
  } else {
    const roomNum = roomIds.data().nextRoomNum;
    roomId = 'ROOM' + roomNum;
    roomIdsDoc.update({ 
      nextRoomNum: roomNum + 1, ['roomNameToId.' + roomName]: roomId });
  }

  // Set a user ID
  const roomDoc = roomsCollection.doc(roomId);
  localUserId = 'USER0';
  roomDoc.set({ roomName: roomName, nextUserNum: 1, userIds: [localUserId] });

  // Set initial coordinates
  const localCoordinates = { row: 0, col: 0 };
  allCoordinates[localUserId] = localCoordinates;

  // Update user settings
  const userSettings = roomDoc.collection('userSettings');
  userSettings.doc('userNames').set({ USER0: localUserName });
  userSettings.doc('USER0coordinates').set(localCoordinates);

  // Display the user's local video
  _initializeVideoGrid();
  _setVideoGridVolumeAndColor(localCoordinates);
  const localVideo = videoGrid[0][0];
  localVideo.setAttribute('id', 'localVideo');
  localVideo.muted = true;
  localVideo.srcObject = localStream;

  _waitForOtherUsers(roomDoc);
  return RESPONSE.SUCCESS;
}

/*******************************************************************************
 * Join a room (initiate peer connections with all the users in the room).
 ******************************************************************************/
async function _joinRoom(roomName) {
  console.log(`_joinRoom(${roomName})`);

  // Verify that this room name exists
  roomsCollection = await firebase.firestore().collection('rooms');
  const roomIds = await roomsCollection.doc('roomIds').get();
  const roomNameToId = roomIds.data().roomNameToId;
  if (!roomIds.data() || !Object.keys(roomNameToId).includes(roomName)) {
    return RESPONSE.ROOM_DOESNT_EXIST_ERROR;
  }

  // Set the room ID
  roomId = roomNameToId[roomName];

  // Set a user ID
  const roomDoc = roomsCollection.doc(roomId);
  const room = await roomDoc.get();
  const localUserNum = room.data().nextUserNum;
  localUserId = `USER${localUserNum}`;
  roomDoc.update({ 
    nextUserNum: localUserNum + 1, 
    userIds: firebase.firestore.FieldValue.arrayUnion(localUserId)
  });

  // Select initial coordinates
  const userSettings = roomDoc.collection('userSettings');
  const userSettingsSnapshot = await userSettings.get();
  const localCoordinates = _getAvailableTile(
    userSettingsSnapshot.docs.filter(doc => doc.id.includes('coordinates')));
  allCoordinates[localUserId] = localCoordinates;

  // Update user settings
  userSettings.doc('userNames').update({ [localUserId]: localUserName });
  userSettings.doc(`${localUserId}coordinates`).set(localCoordinates);

  // Display the user's local video
  _initializeVideoGrid();
  _setVideoGridVolumeAndColor(localCoordinates);
  const localVideo = videoGrid[localCoordinates.row][localCoordinates.col];
  localVideo.setAttribute('id', 'localVideo');
  localVideo.muted = true;
  localVideo.srcObject = localStream;

  // Initiate peer connections with all the users in the room
  const userIds = room.data().userIds;
  for (let remoteUserId of userIds) {
    if (remoteUserId !== localUserId) {
      _doUserJoin(
        roomDoc,
        roomDoc.collection(`from${remoteUserId}`).doc(`to${localUserId}`),
        remoteUserId);
    }
  }

  _waitForOtherUsers(roomDoc);
  return RESPONSE.SUCCESS;
}

/*******************************************************************************
 * Leave the room (terminate peer connections with all the users in the room).
 ******************************************************************************/
async function _leaveRoom(roomId) {
  console.log('_leaveRoom()');

  // Terminate peer connections with all the users in the room.
   _doUserExit();

  // Delete all the relevant data in Firestore.
  const roomDoc = roomsCollection.doc(roomId);
  const room = await roomDoc.get();
  if (room.data()) {
    // Must do: delete the user coordinates and user ID.
    const userSettingsCollection = roomDoc.collection('userSettings');
    await userSettingsCollection.doc(`${localUserId}coordinates`).delete();
    await roomDoc.update({
      userIds: firebase.firestore.FieldValue.arrayRemove(localUserId),
    });

    // Nice to do: delete the user name.
    const userNamesDoc = userSettingsCollection.doc('userNames');
    const userNames = await userNamesDoc.get();
    if (userNames.data()) {
      const userNamesData = userNames.data();
      delete userNamesData[localUserId];
      await userNamesDoc.update(userNamesData);
    }

    // Nice to do: delete the fromUSER# collection (don't bother deleting all
    // of the toUSER# collections).
    const fromUSER = await roomDoc.collection(`from${localUserId}`).get();
    fromUSER.forEach(async candidate => await candidate.ref.delete());

    // If this is the last user in the room, delete the room entirely.
    if (room.data().userIds.length === 1) {
      // Nice to do: delete the room name and room ID.
      const roomIdsDoc = roomsCollection.doc('roomIds');
      const roomIds = await roomIdsDoc.get();

      if (roomIds.data()) {
        const roomNameToId = roomIds.data().roomNameToId;
        delete roomNameToId[roomName];
        await roomIdsDoc.update({ roomNameToId : roomNameToId });
      }

      // Nice to do: delete the ROOM# doc (It isn't possible to recursively
      // delete the ROOM# doc, nor is it possible to retrieve the list of
      // subcollections in the doc to manually delete them one-by-one, so this
      // is the best we can do).
      const userSettings = await userSettingsCollection.get();
      userSettings.forEach(async candidate => await candidate.ref.delete());
      roomDoc.delete();
    }
  }

  return;
}

/*******************************************************************************
 * On cameraBtn click, open user media.
 ******************************************************************************/
async function _onCameraBtnClick(e) {
  console.log('Clicked the "Enable Camera & Mic" button');

  const userNameInput = _dom('#userNameInput');
  const roomNameInput = _dom('#roomNameInput');
  const createBtn = _dom('#createBtn');
  const joinBtn = _dom('#joinBtn');

  // Hide camera button, and enable username and room name input
  _dom('#cameraBtn').style.display = 'none';
  userNameInput.disabled = false;
  roomNameInput.disabled = false;

  // Enable create and join room buttons on input
  function enableCreateOrJoinRoom() {
    if (userNameInput.value && roomNameInput.value) {
      createBtn.disabled = false;
      joinBtn.disabled = false;
    } else {
      createBtn.disabled = true;
      joinBtn.disabled = true;
    }
  }
  userNameInput.oninput = enableCreateOrJoinRoom;
  roomNameInput.oninput = enableCreateOrJoinRoom;

  // Capture the local stream
  localStream = await navigator.mediaDevices.getUserMedia({
    video: VIDEO_CONSTRAINTS, audio: AUDIO_CONSTRAINTS});
  _dom('#localVideoPreview').srcObject = localStream;
}

/*******************************************************************************
 * On createBtn click, create a new room with the given name.
 ******************************************************************************/
async function _onCreateBtnClick(e) {
  console.log('Clicked the "Create Room" button');

  localUserName = _dom('#userNameInput').value;
  roomName = _dom('#roomNameInput').value;

  const response = await _createRoom(roomName);
  if (response === RESPONSE.ROOM_ALREADY_EXISTS_ERROR) {
    _dom('#createOrJoinError').style.display = 'block';
    _dom('#createOrJoinError').innerText = `"${roomName}" is already ` +
      'being used! Try a different room name.';
  } else {
    // Display the room page
    _dom('#currentUser').innerText = `User: ${localUserName}`;
    _dom('#currentRoom').innerText = `Room: ${roomName}`;
    _dom('#homePage').style.display = 'none';
    _dom('#roomPage').style.display = 'flex';
  }
}

/*******************************************************************************
 * On joinBtn click, join the room with the given name.
 ******************************************************************************/
async function _onJoinBtnClick(e) {
  console.log('Clicked the "Join Room" button');

  localUserName = _dom('#userNameInput').value;
  roomName = _dom('#roomNameInput').value;

  const response = await _joinRoom(roomName);
  if (response === RESPONSE.ROOM_DOESNT_EXIST_ERROR) {
    _dom('#createOrJoinError').style.display = 'block';
    _dom('#createOrJoinError').innerText = `"${roomName}" doesn't exist! ` +
      'Try a different room name.';
  } else {
    // Display the room page
    _dom('#currentUser').innerText = `User: ${localUserName}`;
    _dom('#currentRoom').innerText = `Room: ${roomName}`;
    _dom('#homePage').style.display = 'none';
    _dom('#roomPage').style.display = 'block';
  }
}

/*******************************************************************************
 * On hangupBtn click, leave the room.
 ******************************************************************************/
async function _onHangupBtnClick(e) {
  console.log('Clicked the "Leave Room" button');

  await _leaveRoom(roomId);
  document.location.reload(true);
}

// Add all the button click event listeners
_dom('#cameraBtn').onclick = _onCameraBtnClick;
_dom('#createBtn').onclick = _onCreateBtnClick;
_dom('#joinBtn').onclick = _onJoinBtnClick;
_dom('#hangupBtn').onclick = _onHangupBtnClick;