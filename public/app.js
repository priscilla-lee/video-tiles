// Constants
const CONFIGURATION = {
  iceCandidatePoolSize: 10,
  iceServers: [{
    urls: [
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
    ],
  }]
};
const PROXIMITY = {
  NEAREST:  2,
  NEAR:     4,
  FAR:      6,
  FARTHEST: 8
}
const VOLUME = {
  NEAREST:  1.0,
  NEAR:     0.5,
  FAR:      0.1,
  FARTHEST: 0.0
}
const COLOR = { // www.w3schools.com/colors/colors_picker.asp?colorhex=4682B4
  NEAREST:     '#a4c2db', // 75%
  NEAR:        '#6d9dc5', // 60%
  FAR:         '#4178a4', // 45%
  FARTHEST:    '#2c506d', // 30%
  TOAST_JOIN:  'rgba(220, 255, 210, 0.9)', // green
  TOAST_LEAVE: 'rgba(255, 220, 220, 0.9)'  // red
}
const RESPONSE = {
  SUCCESS: 0,
  ROOM_DOESNT_EXIST_ERROR: 1,
  ROOM_ALREADY_EXISTS_ERROR: 2
}
const MAX_BITRATE = 250000;
const SCALE_RESOLUTION_DOWN_BY = 2;
const NUM_ROWS = 6;
const NUM_COLS = 12;

// Global variables
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

// TODO(10): Test on Firefox.

// TODO(12): Let users move around using arrow keys.

// TODO(13): Apply JS tips/tricks/best practices from Fireship's YouTube
// channel.

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
function _isTileAvailable(potentialCoordinates) {
  const pRow = potentialCoordinates.row;
  const pCol = potentialCoordinates.col;

  for (var userId in allCoordinates) {
    const existingCoordinates = allCoordinates[userId];
    const eRow = existingCoordinates.row;
    const eCol = existingCoordinates.col;
    if (pRow == eRow && pCol == eCol) return false;
  }
  return true;
}

/*******************************************************************************
 * Returns the first available tile based on the list of given userCoordinates
 * doc snapshots.
 ******************************************************************************/
function _getAvailableTile(userCoordinates) {
  for (var i in userCoordinates) {
    const snapshot = userCoordinates[i];
    const userId = snapshot.id.substring(0, snapshot.id.length - 11);
    allCoordinates[userId] = snapshot.data();
  }

  // Find the first available tile
  for (var r = 0; r < NUM_ROWS; r++) {
    for (var c = 0; c < NUM_COLS; c++) {
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
  let videoSender = peerConnection.getSenders().find(
    s => s.track.kind === 'video');
  let params = videoSender.getParameters();
  if (!params.encodings) { params.encodings = [{}]; }
  params.encodings[0].scaleResolutionDownBy = SCALE_RESOLUTION_DOWN_BY;
  params.encodings[0].maxBitrate = MAX_BITRATE;
  videoSender.setParameters(params);
}

/*******************************************************************************
 * Set the volume and color of each video in the grid based on its proximity to
 * the local user's current location.
 ******************************************************************************/
function _setVideoGridVolumeAndColor(localUserCoordinates) {
  for (var r = 0; r < NUM_ROWS; r++) {
    for (var c = 0; c < NUM_COLS; c++) {
      const dr = Math.abs(localUserCoordinates.row - r);
      const dc = Math.abs(localUserCoordinates.col - c);
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
  console.log('_initializeVideoGrid');

  // Create the grid of videos
  videoGrid = [];
  videoTileGrid = [];
  for (var i = 0; i < NUM_ROWS; i++) {
    videoGrid[i] = new Array(NUM_COLS);
    videoTileGrid[i] = new Array(NUM_COLS);
  }

  const videoTileGridDiv = _dom('#videoTileGrid');
  for (var r = 0; r < NUM_ROWS; r++) {
    for (var c = 0; c < NUM_COLS; c++) {
      // Create a 'Move here' overlay.
      let moveHere = document.createElement('div');
      moveHere.setAttribute('class', 'moveHere');
      moveHere.innerHTML = '<div style="margin: auto;">Move<br>here</div>';

      // Create a video tile
      let videoTile = document.createElement('div');
      videoTile.setAttribute('class', 'videoTile');
      videoTile.onclick = (() => {
        var _r = r; var _c = c; var _moveHere = moveHere; // Closure vars
        return () => _onVideoTileClick(_r, _c, _moveHere);
      })();

      // Display the "Move here" overlay on hover.
      videoTile.onmouseenter = (() => {
        var _r = r; var _c = c; var _moveHere = moveHere; // Closure vars
        return () => {
          if (videoGrid[_r][_c].srcObject == null) {
            _moveHere.style.display = 'flex';
          }
        };
      })();
      videoTile.onmouseleave = (() => {
        var _moveHere = moveHere; // Closure vars
        return () => _moveHere.style.display = 'none';
      })();

      // Create a video element
      let video = document.createElement('video');
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
}

/*******************************************************************************
 * Create a peer connection between the local and remote users.
 ******************************************************************************/
function _createPeerConnection(roomDoc, p2pDoc, localUserId, remoteUserId) {
  console.log('_createPeerConnection');

  // (1a) Send in local stream through a new peer connection
  let peerConnection = new RTCPeerConnection(CONFIGURATION);
  peerConnections[`to${remoteUserId}`] = peerConnection;
  localStream.getTracks().forEach(t => { 
    peerConnection.addTrack(t, localStream);
  });

  // (1b) Listen for remote stream through the peer connection
  let remoteStream = new MediaStream();
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
  console.log('_onUserJoin');

  // Display a brief toast notification that this user joined the call
  const names = await roomDoc.collection('userSettings').doc('userNames').get();
  const remoteUserName = names.data()[remoteUserId];
  _addToast(`${remoteUserName} joined the call!`, COLOR.TOAST_JOIN);

  let peerConnection = 
    _createPeerConnection(roomDoc, p2pDoc, localUserId, remoteUserId);

  // Receive the offer
  p2pDoc.get().then(snapshot => {
    const description = new RTCSessionDescription(snapshot.data().offer);
    peerConnection.setRemoteDescription(description).then(() => {
      return peerConnection.createAnswer();
    }).then(answer => {
      // Send a response
      p2pDoc.update({answer: { type: answer.type, sdp: answer.sdp }});
      return peerConnection.setLocalDescription(answer);
    }).then(() => _downscaleVideo(peerConnection));
  });  
}

/*******************************************************************************
 * Respond to the given remote user moving video tile locations.
 ******************************************************************************/
function _onUserMove(roomDoc, newCoordinates, remoteUserId) {
  console.log('_onUserMove');

  // Update all coordinates
  const oldCoordinates = allCoordinates[remoteUserId];
  allCoordinates[remoteUserId] = newCoordinates;

  // Update the remote user's video position
  videoGrid[oldCoordinates.row][oldCoordinates.col].srcObject = null;
  videoGrid[newCoordinates.row][newCoordinates.col].srcObject = 
    remoteStreams[remoteUserId];

  _setVideoGridVolumeAndColor(allCoordinates[localUserId]);
}

/*******************************************************************************
 * Respond to the given remote user exiting the call.
 ******************************************************************************/
async function _onUserExit(roomDoc, remoteUserId) {
  console.log('_onUserExit');

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
function _doUserJoin(roomDoc, p2pDoc, remoteUserId) {
  console.log('_doUserJoin');

  let peerConnection = 
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
  peerConnection.createOffer().then(offer => {
    p2pDoc.set({offer: { type: offer.type, sdp: offer.sdp }});
    return peerConnection.setLocalDescription(offer);
  }).then(() => _downscaleVideo(peerConnection));
}

/*******************************************************************************
 * Move video tile locations, and broadcast the update to all users in the call.
 ******************************************************************************/
function _doUserMove(newCoordinates) {
  console.log('_doUserMove');

  // Update coordinates
  const oldCoordinates = allCoordinates[localUserId];
  allCoordinates[localUserId] = newCoordinates;
  roomsCollection.doc(roomId).collection('userSettings')
    .doc(`${localUserId}coordinates`).update(newCoordinates);

  // Update the local user's video position
  const oldVideo = videoGrid[oldCoordinates.row][oldCoordinates.col]
  oldVideo.srcObject = null;
  oldVideo.muted = false;
  oldVideo.setAttribute('id', '');
  const newVideo = videoGrid[newCoordinates.row][newCoordinates.col];
  newVideo.srcObject = localStream;
  newVideo.muted = true;
  newVideo.setAttribute('id', 'localVideo');

  _setVideoGridVolumeAndColor(newCoordinates);
}

/*******************************************************************************
 * Terminate the connections with all the users in the call.
 ******************************************************************************/
function _doUserExit() {
  console.log('_doUserExit');

  // Stop the local stream.
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
  }

  // Stop all remote streams.
  for (var id in remoteStreams) {
    if (remoteStreams[id]) {
      remoteStreams[id].getTracks().forEach(t => t.stop());
    }
  }

  // Close all peer connections.
  for (var id in peerConnections) {
    if (peerConnections[id]) {
      peerConnections[id].close();
    }
  }
}

/*******************************************************************************
 * Wait for other user(s) to join the room, move tiles, or leave the room.
 ******************************************************************************/
function _waitForOtherUsers(roomDoc) {
  console.log('_waitForOtherUsers');

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
  console.log('_createRoom');

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
  console.log('_joinRoom');

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
  for (var i in userIds) {
    const remoteUserId = userIds[i];
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
  console.log('_leaveRoom');

  // Terminate peer connections with all the users in the room.
   _doUserExit();

  // Delete all the relevant data in Firestore.
  const roomDoc = roomsCollection.doc(roomId);
  const room = await roomDoc.get();
  if (room.data()) {
    // Must do: delete the user coordinates and user ID.
    const userSettingsCollection = roomDoc.collection('userSettings');
    await userSettingsCollection.doc(`${localUserId}coordinates`).delete();
    roomDoc.update({
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
    if (room.data().userIds.length == 1) {
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
  console.log('_onCameraBtnClick');

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
  localStream = await navigator.mediaDevices.getUserMedia(
      {video: true, audio: true});
  _dom('#localVideoPreview').srcObject = localStream;
}

/*******************************************************************************
 * On createBtn click, create a new room with the given name.
 ******************************************************************************/
function _onCreateBtnClick(e) {
  console.log('_onCreateBtnClick');

  localUserName = _dom('#userNameInput').value;
  roomName = _dom('#roomNameInput').value;

  _createRoom(roomName).then((response) => {
    if (response == RESPONSE.ROOM_ALREADY_EXISTS_ERROR) {
      _dom('#createOrJoinError').style.display = 'block';
      _dom('#createOrJoinError').innerText = `"${roomName}" is already ` +
        'being used! Try a different room name.';
    } else {
      // Display the room page
      _dom('#currentUser').innerText = `User: ${localUserName}`;
      _dom('#currentRoom').innerText = `Room: ${roomName}`;
      _dom('#homePage').style.display = 'none';
      _dom('#roomPage').style.display = 'block';
    }
  });
}

/*******************************************************************************
 * On joinBtn click, join the room with the given name.
 ******************************************************************************/
function _onJoinBtnClick(e) {
  console.log('_onJoinBtnClick');

  localUserName = _dom('#userNameInput').value;
  roomName = _dom('#roomNameInput').value;

  _joinRoom(roomName).then((response) => {
    if (response == RESPONSE.ROOM_DOESNT_EXIST_ERROR) {
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
  });
}

/*******************************************************************************
 * On hangupBtn click, leave the room.
 ******************************************************************************/
async function _onHangupBtnClick(e) {
  console.log('_onHangupBtnClick');

  await _leaveRoom(roomId);
  document.location.reload(true);
}

/*******************************************************************************
 * On videoTile click, update the local user's location on the tile grid.
 ******************************************************************************/
function _onVideoTileClick(row, col, moveHere) {
  console.log('_onVideoTileClick');

  const coordinates = {row: row, col: col};
  if (_isTileAvailable(coordinates)) {
    _doUserMove(coordinates);
    moveHere.style.display = 'none';
  } else {
    console.log('That tile is already occupied!');
  }
}

// Add all the button click event listeners
_dom('#cameraBtn').onclick = _onCameraBtnClick;
_dom('#createBtn').onclick = _onCreateBtnClick;
_dom('#joinBtn').onclick = _onJoinBtnClick;
_dom('#hangupBtn').onclick = _onHangupBtnClick;