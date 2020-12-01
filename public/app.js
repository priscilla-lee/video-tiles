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
const COLORS = { // www.w3schools.com/colors/colors_picker.asp?colorhex=4682B4
  NEAREST:  "#a4c2db", // 75%
  NEAR:     "#6d9dc5", // 60%
  FAR:      "#4178a4", // 45%
  FARTHEST: "#2c506d"  // 30%
}
const MAX_BITRATE = 250000;
const SCALE_RESOLUTION_DOWN_BY = 2;
const NUM_ROWS = 6;
const NUM_COLS = 12;

// Global variables
let roomId = null;
let roomName = null;
let videoGrid = null;
let isTileAvailable = null;
let localUserId = null;
let localUserName = null;
let localStream = null;
let coordinates = {};
let peerConnections = {};
let remoteStreams = {};

/*******************************************************************************
 * Create a peer connection between the local and remote users
 ******************************************************************************/
function _createPeerConnection(p2pDoc, localUserId, remoteUserId) {
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

  // (2a) Add local ICE candidates
  const candidates = p2pDoc.collection(`${localUserId}candidates`);
  peerConnection.onicecandidate = e => {
    if (e.candidate) { candidates.add(e.candidate.toJSON()); }
  };

  // (2b) Listen for remote ICE candidates
  p2pDoc.collection(`${remoteUserId}candidates`).onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
      if (change.type === 'added') {
        await peerConnection.addIceCandidate(
          new RTCIceCandidate(change.doc.data()));
      }
    });
  });

  return peerConnection;
}

/*******************************************************************************
 * Downscale the video resolution and bitrate before sending video track to peer
 ******************************************************************************/
async function _downscaleVideo(peerConnection) {
  let videoSender = peerConnection.getSenders().find(
    s => s.track.kind === 'video');
  let params = videoSender.getParameters();
  if (!params.encodings) { params.encodings = [{}]; }
  params.encodings[0].scaleResolutionDownBy = SCALE_RESOLUTION_DOWN_BY;
  params.encodings[0].maxBitrate = MAX_BITRATE;
  await videoSender.setParameters(params);
}

/*******************************************************************************
 * Respond to the given remote user joining the call
 ******************************************************************************/
async function _onUserJoin(roomDoc, p2pDoc, remoteUserId) {
  let peerConnection = _createPeerConnection(p2pDoc, localUserId, remoteUserId);

  // Receive the offer
  const docSnapshot = await p2pDoc.get();
  await peerConnection.setRemoteDescription(
    new RTCSessionDescription(docSnapshot.data().offer));

  // Send a response
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  await p2pDoc.update({answer: { type: answer.type, sdp: answer.sdp }});

  _downscaleVideo(peerConnection);

  // Add the incoming remote user's video stream to the correct tile
  // TODO: Factor out a helper function so we don't repeat code in
  // _onUserJoin and _doUserJoin.
  const remoteUserCoordinates = await roomDoc.collection('userSettings')
    .doc(`${remoteUserId}coordinates`).get();
  const remoteCoordinates = remoteUserCoordinates.data();
  coordinates[remoteUserId] = remoteCoordinates;
  videoGrid[remoteCoordinates.row][remoteCoordinates.col].srcObject = 
    remoteStreams[remoteUserId];

  // TODO: Add a tiny pop up notification when a user joins (using a Bootstrap
  // toast component).
}

/*******************************************************************************
 * Respond to the given remote user moving video tile locations
 ******************************************************************************/
async function _onUserMove(roomDoc, newCoordinates, remoteUserId) {
  // Update coordinates
  const oldCoordinates = coordinates[remoteUserId];
  coordinates[remoteUserId] = newCoordinates;

  // Update isTileAvailable
  const userTilesSnapshot = 
    await roomDoc.collection('userSettings').doc('userTiles').get();
  isTileAvailable = userTilesSnapshot.data().isAvailable;

  // Update the remote user's video position
  videoGrid[oldCoordinates.row][oldCoordinates.col].srcObject = null;
  videoGrid[newCoordinates.row][newCoordinates.col].srcObject = 
    remoteStreams[remoteUserId];

  // TODO: Update the remote user's audio volume.
}

/*******************************************************************************
 * Respond to the given remote user exiting the call
 ******************************************************************************/
function _onUserExit(remoteUserId) {
  // TODO: Implement this function
}

/*******************************************************************************
 * Initiate a connection with the given user in the call
 ******************************************************************************/
async function _doUserJoin(roomDoc, p2pDoc, remoteUserId) {
  let peerConnection = _createPeerConnection(p2pDoc, localUserId, remoteUserId);

  // Listen for a response
  p2pDoc.onSnapshot(async snapshot => {
    const data = snapshot.data();
    if (!peerConnection.currentRemoteDescription && data && data.answer) {
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(data.answer));
    }
  });

  // Initiate an offer
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  await p2pDoc.set({offer: { type: offer.type, sdp: offer.sdp }});

  _downscaleVideo(peerConnection);

  // Add the other remote user's video stream to the correct tile
  const remoteUserCoordinates = await roomDoc.collection('userSettings')
    .doc(`${remoteUserId}coordinates`).get();
  const remoteCoordinates = remoteUserCoordinates.data();
  coordinates[remoteUserId] = remoteCoordinates;
  videoGrid[remoteCoordinates.row][remoteCoordinates.col].srcObject = 
    remoteStreams[remoteUserId];
}

/*******************************************************************************
 * Move video tile locations, and broadcast the update to all users in the call
 ******************************************************************************/
function _doUserMove(TODO) {
  // TODO: Implement this function
}

/*******************************************************************************
 * Terminate the connection with the given user in the call
 ******************************************************************************/
function _doUserExit(remoteUserId) {
  // TODO: Implement this function
}

/*******************************************************************************
 * Wait for other user(s) to join the room, move tiles, or leave the room
 ******************************************************************************/
function _waitForOtherUsers(roomDoc) {
  roomDoc.collection(`from${localUserId}`).onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
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
    snapshot.docChanges().forEach(async change => {
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
 * Create a new room (first user on the video call)
 ******************************************************************************/
async function _createRoom(roomName) {
  // Verify that this room name isn't being used already
  const roomsCollection = await firebase.firestore().collection('rooms');
  const roomIds = await roomsCollection.doc('roomIds').get();
  if (roomIds.data()) {
    const roomNameToId = roomIds.data().roomNameToId;
    if (Object.keys(roomNameToId).includes(roomName)) {
      console.log("This room name is already being used!");
      return;
    }
  }

  // Grab a roomId, and add it to the list
  if (!roomIds.data()) {
    roomId = 'ROOM0';
    roomsCollection.doc('roomIds').set({ 
      nextRoomNum: 1, 
      roomNameToId: { [roomName]: roomId } 
    });
  } else {
    const roomNum = roomIds.data().nextRoomNum;
    roomId = 'ROOM' + roomNum;
    roomNameToIdRoomName = 'roomNameToId.' + roomName
    roomsCollection.doc('roomIds').update({ 
      nextRoomNum: roomNum + 1, 
      [roomNameToIdRoomName]: roomId
    });
  }

  // Grab a user ID, and add it to the list
  const roomDoc = roomsCollection.doc(roomId);
  localUserId = 'USER0';
  await roomDoc.set({ 
    roomName: roomName, nextUserNum: 1, userIds: [localUserId] 
  });

  // Update user settings
  const userSettings = roomDoc.collection('userSettings');
  await userSettings.doc('userNames').set({ USER0: localUserName });
  isTileAvailable = {};
  for (var r = 0; r < NUM_ROWS; r++) {
    isTileAvailable[r] = new Array(NUM_COLS).fill(true);
  }
  isTileAvailable[0][0] = false;
  localCoordinates = { row: 0, col: 0 };
  coordinates[localUserId] = localCoordinates;
  await userSettings.doc('userTiles').set({isAvailable: isTileAvailable});
  await userSettings.doc('USER0coordinates').set(localCoordinates);

  // Display the user's local video
  const localVideo = videoGrid[0][0];
  localVideo.setAttribute("id", "localVideo");
  localVideo.muted = true;
  localVideo.srcObject = localStream;

  _waitForOtherUsers(roomDoc);
}

/*******************************************************************************
 * Join a room (initiate peer connections with all the users in the room)
 ******************************************************************************/
async function _joinRoom(roomName) {
  // Grab the roomId
  const roomsCollection = await firebase.firestore().collection('rooms');
  const roomIds = await roomsCollection.doc('roomIds').get();
  const roomNameToId = roomIds.data().roomNameToId;
  if (!roomIds.data() || !Object.keys(roomNameToId).includes(roomName)) {
    console.log("This room name doesn't exist!");
    return;
  }
  roomId = roomNameToId[roomName];

  // Grab a user ID, and add it to the list
  const roomDoc = roomsCollection.doc(roomId);
  const room = await roomDoc.get();
  const localUserNum = room.data().nextUserNum;
  localUserId = `USER${localUserNum}`;
  await roomDoc.update({ 
    nextUserNum: localUserNum + 1, 
    userIds: firebase.firestore.FieldValue.arrayUnion(localUserId)
  });

  // Update user settings
  const userSettings = roomDoc.collection('userSettings');
  await userSettings.doc('userNames').update({ [localUserId]: localUserName });
  const userTilesSnapshot = await userSettings.doc('userTiles').get();
  isTileAvailable = userTilesSnapshot.data().isAvailable;

  function selectAvailableTile(isAvailable) {
    for (var r in isAvailable) {
      for (var c in isAvailable[r]) {
        if (isAvailable[r][c]) {
          isAvailable[r][c] = false;
          return { row: r, col: c };
        }
      }
    } return null;
  }
  localCoordinates = selectAvailableTile(isTileAvailable);
  coordinates[localUserId] = localCoordinates;
  await userSettings.doc('userTiles').set({isAvailable: isTileAvailable});
  await userSettings.doc(`${localUserId}coordinates`).set(localCoordinates);

  // Display the user's local video
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
}

/*******************************************************************************
 * Leave the room (terminate peer connections with all the users in the room)
 ******************************************************************************/
async function _leaveRoom(roomId) {
  // TODO: Implement this function

  return;

  const tracks = document.querySelector('#localVideo').srcObject.getTracks();
  tracks.forEach(track => {
    track.stop();
  });

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
  }

  if (peerConnection) {
    peerConnection.close();
  }

  document.querySelector('#localVideo').srcObject = null;
  document.querySelector('#remoteVideo').srcObject = null;
  document.querySelector('#cameraBtn').disabled = false;
  document.querySelector('#joinBtn').disabled = true;
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#hangupBtn').disabled = true;
  document.querySelector('#currentRoom').innerText = '';

  // Delete room on hangup
  if (roomId) {
    const roomRef = firebase.firestore().collection('rooms').doc(roomId);
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
 * On videoTile click, update the local user's location on the tile grid.
 ******************************************************************************/
async function _onVideoTileClick(row, col) {
  // TODO: Update the userSettings document to broadcast to other users.

  // TODO: Implement this function

  console.log("Video tile [" + row + ", " + col + "] was clicked");

  // TODO: Update the colors of the video tiles.

  // TODO: Update the volumes of all the remote users.
}

/*******************************************************************************
 * Initialize the grid of video elements, each inside a video tile
 ******************************************************************************/
function _initializeVideoGrid() {
  // Create the grid of videos
  videoGrid = [];
  for (var i = 0; i < NUM_ROWS; i++) {
    videoGrid[i] = new Array(NUM_COLS);
  }

  let videoTileGrid = document.querySelector("#videoTileGrid");
  for (var r = 0; r < NUM_ROWS; r++) {
    for (var c = 0; c < NUM_COLS; c++) {
      // Create a video tile
      let videoTile = document.createElement("div");
      videoTile.setAttribute("class", "videoTile");
      videoTile.onclick = () => _onVideoTileClick(r, c);

      // Create a video element
      let video = document.createElement("video");
      video.autoplay = true;
      video.playsinline = true;

      // Put it all together
      videoGrid[r][c] = video;
      videoTile.appendChild(video);
      videoTileGrid.appendChild(videoTile);
    }
  }
}

/*******************************************************************************
 * On cameraBtn click, open user media
 ******************************************************************************/
async function _onCameraBtnClick(e) {
  const userNameInput = document.querySelector('#userNameInput');
  const roomNameInput = document.querySelector('#roomNameInput');
  const createBtn = document.querySelector('#createBtn');
  const joinBtn = document.querySelector('#joinBtn');

  // Hide camera button, and enable username and room name input
  document.querySelector('#cameraBtn').style.display = "none";
  userNameInput.disabled = false;
  roomNameInput.disabled = false;

  // Capture the local stream
  localStream = await navigator.mediaDevices.getUserMedia(
      {video: true, audio: true});
  document.querySelector('#localVideoPreview').srcObject = localStream;

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
}

/*******************************************************************************
 * On createBtn click, create a new room with the given name.
 ******************************************************************************/
async function _onCreateBtnClick(e) {
  localUserName = document.querySelector('#userNameInput').value;
  roomName = document.querySelector('#roomNameInput').value;
  document.querySelector('#currentUser').innerText = `User: ${localUserName}`;
  document.querySelector('#currentRoom').innerText = `Room: ${roomName}`;

  // TODO: Add a validation error message (e.g. "that room name is already being 
  // used") using Bootstrap alert components.

  _initializeVideoGrid();
  await _createRoom(roomName);

  // Only display the room page when everything's loaded
  document.querySelector('#homePage').style.display = "none";
  document.querySelector('#roomPage').style.display = "block";
}

/*******************************************************************************
 * On joinBtn click, join the room with the given name.
 ******************************************************************************/
async function _onJoinBtnClick(e) {
  localUserName = document.querySelector('#userNameInput').value;
  roomName = document.querySelector('#roomNameInput').value;
  document.querySelector('#currentUser').innerText = `User: ${localUserName}`;
  document.querySelector('#currentRoom').innerText = `Room: ${roomName}`;

  // TODO: Add a validation error message (e.g. "that room name doesn't exist")
  // using Bootstrap alert components.

  _initializeVideoGrid();
  await _joinRoom(roomName);

  // Only display the room page when everything's loaded
  document.querySelector('#homePage').style.display = "none";
  document.querySelector('#roomPage').style.display = "block";
}

/*******************************************************************************
 * On hangupBtn click, leave the room.
 ******************************************************************************/
async function _onHangupBtnClick(e) {
  // TODO: Implement this function

  // _leaveRoom(roomId);
}

// Add all the button click event listeners
document.querySelector('#cameraBtn').onclick = _onCameraBtnClick;
document.querySelector('#createBtn').onclick = _onCreateBtnClick;
document.querySelector('#joinBtn').onclick = _onJoinBtnClick;
document.querySelector('#hangupBtn').onclick = _onHangupBtnClick;