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
  NEAREST:  "#a4c2db", // 75%
  NEAR:     "#6d9dc5", // 60%
  FAR:      "#4178a4", // 45%
  FARTHEST: "#2c506d"  // 30%
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

// TODO(9): Use ' or " consistently.

// TODO(10): Test on Firefox.

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
    allCoordinates[snapshot.id] = snapshot.data();
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
 * Initialize the grid of video elements, each inside a video tile.
 ******************************************************************************/
function _initializeVideoGrid() {
  console.log("_initializeVideoGrid");

  // Create the grid of videos
  videoGrid = [];
  videoTileGrid = [];
  for (var i = 0; i < NUM_ROWS; i++) {
    videoGrid[i] = new Array(NUM_COLS);
    videoTileGrid[i] = new Array(NUM_COLS);
  }

  const videoTileGridDiv = _dom("#videoTileGrid");
  for (var r = 0; r < NUM_ROWS; r++) {
    for (var c = 0; c < NUM_COLS; c++) {
      // Create a video tile
      let videoTile = document.createElement("div");
      videoTile.setAttribute("class", "videoTile");
      videoTile.onclick = (() => {
        var _r = r;
        var _c = c;
        return () => _onVideoTileClick(_r, _c);
      })();

      // Create a video element
      let video = document.createElement("video");
      video.autoplay = true;
      video.playsinline = true;

      // Put it all together
      videoGrid[r][c] = video;
      videoTileGrid[r][c] = videoTile;
      videoTile.appendChild(video);
      videoTileGridDiv.appendChild(videoTile);
    }
  }
}

/*******************************************************************************
 * Set the volume and color of each video in the grid based on its proximity to
 * the local user's current location.
 ******************************************************************************/
function _setVideoGridVolumeAndColor(localUserCoordinates) {
  console.log("_setVideoGridVolumeAndColor");

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
 * Create a peer connection between the local and remote users.
 ******************************************************************************/
function _createPeerConnection(roomDoc, p2pDoc, localUserId, remoteUserId) {
  console.log("_createPeerConnection");

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

  return peerConnection;
}

/*******************************************************************************
 * Downscale the video resolution and bitrate before sending the local user's
 * video track to this peer.
 ******************************************************************************/
function _downscaleVideo(peerConnection) {
  console.log("_downscaleVideo");

  let videoSender = peerConnection.getSenders().find(
    s => s.track.kind === 'video');
  let params = videoSender.getParameters();
  if (!params.encodings) { params.encodings = [{}]; }
  params.encodings[0].scaleResolutionDownBy = SCALE_RESOLUTION_DOWN_BY;
  params.encodings[0].maxBitrate = MAX_BITRATE;
  videoSender.setParameters(params);
}

/*******************************************************************************
 * Respond to the given remote user joining the call.
 ******************************************************************************/
function _onUserJoin(roomDoc, p2pDoc, remoteUserId) {
  console.log("_onUserJoin");

  // TODO(7): Add a tiny pop up notification when a user joins (using a 
  // Bootstrap toast component).

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
  console.log("_onUserMove");

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
function _onUserExit(remoteUserId) {
  console.log("_onUserExit");

  // TODO(5): Implement this function
}

/*******************************************************************************
 * Initiate a connection with the given user in the call.
 ******************************************************************************/
function _doUserJoin(roomDoc, p2pDoc, remoteUserId) {
  console.log("_doUserJoin");

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
  console.log("_doUserMove");

  // Update coordinates
  const oldCoordinates = allCoordinates[localUserId];
  allCoordinates[localUserId] = newCoordinates;
  roomsCollection.doc(roomId).collection('userSettings')
    .doc(`${localUserId}coordinates`).update(newCoordinates);

  // Update the local user's video position
  const oldVideo = videoGrid[oldCoordinates.row][oldCoordinates.col]
  oldVideo.srcObject = null;
  oldVideo.muted = false;
  oldVideo.setAttribute("id", "");
  const newVideo = videoGrid[newCoordinates.row][newCoordinates.col];
  newVideo.srcObject = localStream;
  newVideo.muted = true;
  newVideo.setAttribute("id", "localVideo");

  _setVideoGridVolumeAndColor(newCoordinates);
}

/*******************************************************************************
 * Terminate the connection with the given user in the call.
 ******************************************************************************/
function _doUserExit(remoteUserId) {
  console.log("_doUserExit");

  // TODO(5): Implement this function
}

/*******************************************************************************
 * Wait for other user(s) to join the room, move tiles, or leave the room.
 ******************************************************************************/
function _waitForOtherUsers(roomDoc) {
  console.log("_waitForOtherUsers");

  roomDoc.collection(`from${localUserId}`).onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        // A user has joined the room
        const remoteUserId = change.doc.id.substring(2);
        _onUserJoin(roomDoc, change.doc.ref, remoteUserId);
      } else if (change.type === 'removed') {
        // A user has exited the room
        const remoteUserId = change.doc.id.substring(2);
        _onUserExit(remoteUserId);
      }
    });
  });

  roomDoc.collection(`userSettings`).onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'modified') {
        const docId = change.doc.id;
        if (docId.includes("coordinates")) {
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
  console.log("_createRoom");

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
  localVideo.setAttribute("id", "localVideo");
  localVideo.muted = true;
  localVideo.srcObject = localStream;

  _waitForOtherUsers(roomDoc);
  return RESPONSE.SUCCESS;
}

/*******************************************************************************
 * Join a room (initiate peer connections with all the users in the room).
 ******************************************************************************/
async function _joinRoom(roomName) {
  console.log("_joinRoom");

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
    userSettingsSnapshot.docs.filter(doc => doc.id.includes("coordinates")));
  allCoordinates[localUserId] = localCoordinates;

  // Update user settings
  userSettings.doc('userNames').update({ [localUserId]: localUserName });
  userSettings.doc(`${localUserId}coordinates`).set(localCoordinates);

  // Display the user's local video
  _initializeVideoGrid();
  _setVideoGridVolumeAndColor(localCoordinates);
  const localVideo = videoGrid[localCoordinates.row][localCoordinates.col];
  localVideo.setAttribute("id", "localVideo");
  localVideo.muted = true;
  localVideo.srcObject = localStream;

  // Initiate peer connections with all the users in the room
  const userIds = room.data().userIds;
  for (var i in userIds) {
    const remoteUserId = userIds[i];
    _doUserJoin(
      roomDoc,
      roomDoc.collection(`from${remoteUserId}`).doc(`to${localUserId}`), 
      remoteUserId);
  }

  _waitForOtherUsers(roomDoc);
  return RESPONSE.SUCCESS;
}

/*******************************************************************************
 * Leave the room (terminate peer connections with all the users in the room).
 ******************************************************************************/
async function _leaveRoom(roomId) {
  console.log("_leaveRoom");

  // TODO(5): Implement this function

  return;

  const tracks = _dom('#localVideo').srcObject.getTracks();
  tracks.forEach(track => {
    track.stop();
  });

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
  }

  if (peerConnection) {
    peerConnection.close();
  }

  _dom('#localVideo').srcObject = null;
  _dom('#remoteVideo').srcObject = null;
  _dom('#cameraBtn').disabled = false;
  _dom('#joinBtn').disabled = true;
  _dom('#createBtn').disabled = true;
  _dom('#hangupBtn').disabled = true;
  _dom('#currentRoom').innerText = '';

  // Delete room on hangup
  if (roomId) {
    const roomRef = roomsCollection.doc(roomId);
    const calleeCandidates = await roomRef.collection('calleeCandidates').get();
    calleeCandidates.forEach(async candidate => {
      await candidate.ref.delete();
    });
    const callerCandidates = await roomRef.collection('callerCandidates').get();
    callerCandidates.forEach(async candidate => {
      await candidate.ref.delete();
    });
    await roomRef.delete();
  }

  document.location.reload(true);
}

/*******************************************************************************
 * On cameraBtn click, open user media.
 ******************************************************************************/
async function _onCameraBtnClick(e) {
  console.log("_onCameraBtnClick");

  const userNameInput = _dom('#userNameInput');
  const roomNameInput = _dom('#roomNameInput');
  const createBtn = _dom('#createBtn');
  const joinBtn = _dom('#joinBtn');

  // Hide camera button, and enable username and room name input
  _dom('#cameraBtn').style.display = "none";
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
  console.log("_onCreateBtnClick");

  localUserName = _dom('#userNameInput').value;
  roomName = _dom('#roomNameInput').value;

  _createRoom(roomName).then((response) => {
    if (response == RESPONSE.ROOM_ALREADY_EXISTS_ERROR) {
      _dom("#createOrJoinError").style.display = 'block'
      _dom("#createOrJoinError").innerText = `"${roomName}" is already ` +
        'being used! Try a different room name.';
    } else {
      // Display the room page
      _dom('#currentUser').innerText = `User: ${localUserName}`;
      _dom('#currentRoom').innerText = `Room: ${roomName}`;
      _dom('#homePage').style.display = "none";
      _dom('#roomPage').style.display = "block";
    }
  });
}

/*******************************************************************************
 * On joinBtn click, join the room with the given name.
 ******************************************************************************/
function _onJoinBtnClick(e) {
  console.log("_onJoinBtnClick");

  localUserName = _dom('#userNameInput').value;
  roomName = _dom('#roomNameInput').value;

  _joinRoom(roomName).then((response) => {
    if (response == RESPONSE.ROOM_DOESNT_EXIST_ERROR) {
      _dom("#createOrJoinError").style.display = 'block'
      _dom("#createOrJoinError").innerText = `"${roomName}" doesn't exist! ` +
        "Try a different room name.";
    } else {
      // Display the room page
      _dom('#currentUser').innerText = `User: ${localUserName}`;
      _dom('#currentRoom').innerText = `Room: ${roomName}`;
      _dom('#homePage').style.display = "none";
      _dom('#roomPage').style.display = "block";
    }
  });
}

/*******************************************************************************
 * On hangupBtn click, leave the room.
 ******************************************************************************/
function _onHangupBtnClick(e) {
  console.log("_onHangupBtnClick");

  alert("The \"Leave Room\" button doesn't work yet :( " +
    "Just exit the tab for now.");

  // TODO(5): Implement this function

  // _leaveRoom(roomId);
}

/*******************************************************************************
 * On videoTile click, update the local user's location on the tile grid.
 ******************************************************************************/
function _onVideoTileClick(row, col) {
  console.log("_onVideoTileClick");

  // TODO(6): Add another step here (like a "Move here" button).

  const coordinates = {row: row, col: col};
  if (_isTileAvailable(coordinates)) {
    _doUserMove(coordinates);
  } else {
    console.log("That tile is already occupied!");
  }
}

// Add all the button click event listeners
_dom('#cameraBtn').onclick = _onCameraBtnClick;
_dom('#createBtn').onclick = _onCreateBtnClick;
_dom('#joinBtn').onclick = _onJoinBtnClick;
_dom('#hangupBtn').onclick = _onHangupBtnClick;