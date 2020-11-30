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
const MAX_BITRATE = 250000;
const SCALE_RESOLUTION_DOWN_BY = 2;

// Global variables
let roomId = null;
let roomName = null;
let localUserId = null;
let localUserName = null;
let localStream = null;
let peerConnections = {};
let remoteStreams = {};
let roomDialog = null;

/*******************************************************************************
 * Create a peer connection between the local and remote users
 ******************************************************************************/
function _createPeerConnection(doc, localUserId, remoteUserId) {
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
  document.querySelector('#remoteVideo').srcObject = remoteStream;

  // (2a) Add local ICE candidates
  const candidates = doc.collection(`${localUserId}candidates`);
  peerConnection.onicecandidate = e => {
    if (e.candidate) { candidates.add(e.candidate.toJSON()); }
  };

  // (2b) Listen for remote ICE candidates
  doc.collection(`${remoteUserId}candidates`).onSnapshot(snapshot => {
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
 * Respond to the given user joining the call
 ******************************************************************************/
async function _onUserJoin(doc, remoteUserId) {
  let peerConnection = _createPeerConnection(doc, localUserId, remoteUserId);

  // Respond to the offer
  const docSnapshot = await doc.get();
  await peerConnection.setRemoteDescription(
    new RTCSessionDescription(docSnapshot.data().offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  await doc.update({answer: { type: answer.type, sdp: answer.sdp }});

  _downscaleVideo(peerConnection);
}

/*******************************************************************************
 * TODO! Respond to the given user exiting the call
 ******************************************************************************/
function _onUserExit(remoteUserId) {
}

/*******************************************************************************
 * Initiate a connection with the given user in the call
 ******************************************************************************/
async function _doUserJoin(doc, remoteUserId) {
  let peerConnection = _createPeerConnection(doc, localUserId, remoteUserId);

  // Listen for a response
  doc.onSnapshot(async snapshot => {
    const data = snapshot.data();
    if (!peerConnection.currentRemoteDescription && data && data.answer) {
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(data.answer));
    }
  });

  // Initiate an offer
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  await doc.set({offer: { type: offer.type, sdp: offer.sdp }});

  _downscaleVideo(peerConnection);
}

/*******************************************************************************
 * TODO! Terminate the connection with the given user in the call
 ******************************************************************************/
function _doUserExit(remoteUserId) {
}

/*******************************************************************************
 * TODO! Open user media
 ******************************************************************************/
async function openUserMedia(e) {
  const stream = await navigator.mediaDevices.getUserMedia(
      {video: true, audio: true});
  document.querySelector('#localVideo').srcObject = stream;
  localStream = stream;

  document.querySelector('#cameraBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = false;
  document.querySelector('#createBtn').disabled = false;
  document.querySelector('#hangupBtn').disabled = false;

  // Display the user ID
  document.querySelector('#userName').disabled = true;
  localUserName = document.querySelector('#userName').value;
  document.querySelector('#currentUser').innerText = `User is ${localUserName}`;
}

/*******************************************************************************
 * Create a new room (first user on the video call)
 ******************************************************************************/
async function createRoom(roomName) {
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
  document.querySelector('#currentRoom').innerText = `Room: ${roomName}`;

  // Grab a user ID, and add it to the list
  const roomDoc = roomsCollection.doc(roomId);
  localUserId = 'USER0';
  await roomDoc.set({ 
    roomName: roomName, nextUserNum: 1, userIds: [localUserId] 
  });

  // Update user settings
  const userSettings = roomDoc.collection('userSettings');
  await userSettings.doc('userNames').set({ USER0: localUserName });
  await userSettings.doc('userTiles').set({
    isTileAvailable: {
      0: [false, true, true],
      1: [true , true, true],
      2: [true , true, true],
    },
    USER0: { row: 0, col: 0 }
  });

  // Wait for other user(s) to join or leave the room
  roomDoc.collection(`from${localUserId}`).onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
      if (change.type === 'added') {
        // A user has joined the room
        const remoteUserId = change.doc.id.substring(2);
        _onUserJoin(change.doc.ref, remoteUserId);
      } else if (change.type === 'removed') {
        // A user has exited the room
        const remoteUserId = change.doc.id.substring(2);
        _onUserExit(remoteUserId);
      }
    });
  });
}

/*******************************************************************************
 * Join a room (initiate peer connections with all the users in the room)
 ******************************************************************************/
async function joinRoom(roomName) {
  // Grab the roomId
  const roomsCollection = await firebase.firestore().collection('rooms');
  const roomIds = await roomsCollection.doc('roomIds').get();
  const roomNameToId = roomIds.data().roomNameToId;
  if (!roomIds.data() || !Object.keys(roomNameToId).includes(roomName)) {
    console.log("This room name doesn't exist!");
    return;
  }
  const roomId = roomNameToId[roomName];
  document.querySelector('#currentRoom').innerText = `Room: ${roomName}`;

  // Grab a user ID
  const roomDoc = roomsCollection.doc(roomId);
  const room = await roomDoc.get();
  const localUserNum = room.data().nextUserNum;
  localUserId = `USER${localUserNum}`;

  // Initiate peer connections with all the users in the room
  const userIds = room.data().userIds;
  for (var i in userIds) {
    const remoteUserId = userIds[i];
    let doc = roomDoc.collection(`from${remoteUserId}`).doc(`to${localUserId}`);
    _doUserJoin(doc, remoteUserId);
  }

  // Add the user ID to the list
  await roomDoc.update({ 
    nextUserNum: localUserNum + 1, 
    userIds: firebase.firestore.FieldValue.arrayUnion(localUserId)
  });

  // Update user settings
  const userSettings = roomDoc.collection('userSettings');
  await userSettings.doc('userNames').update({
    [localUserId]: localUserName 
  });
  await userSettings.doc('userTiles').update({
    isTileAvailable: {
      0: [false, false, true],
      1: [true , true, true],
      2: [true , true, true],
    },
    [localUserId]: { row: 0, col: 1 }
  });

  // Wait for other user(s) to join or leave the room
  roomDoc.collection(`from${localUserId}`).onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
      if (change.type === 'added') {
        // A user has joined the room
        const remoteUserId = change.doc.id.substring(2);
        _onUserJoin(change.doc.ref, remoteUserId);
      } else if (change.type === 'removed') {
        // A user has exited the room
        const remoteUserId = change.doc.id.substring(2);
        _onUserExit(remoteUserId);
      }
    });
  });
}

/*******************************************************************************
 * TODO! Join a room (initiate peer connections with all the users in the room)
 ******************************************************************************/
async function hangUp(e) {
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
 * TODO! Initialize the DOM elements (videos, buttons, etc)
 ******************************************************************************/
function initDomElements() {
  var NUM_ROWS = 7;
  var NUM_COLS = 16;

  // Add a grid of video squares
  var videoSquares = [];
  for(var i = 0; i < NUM_ROWS; i++) {
      videoSquares[i] = new Array(NUM_COLS);
  }

  let videoGrid = document.querySelector("#videoGrid");
  for (var row = 0; row < NUM_ROWS; row++) {
    for (var col = 0; col < NUM_COLS; col++) {
      let videoSquare = document.createElement("div");
      videoSquare.setAttribute("class", "videoSquare");
      videoGrid.appendChild(videoSquare);
      videoSquares[row][col] = videoSquare;
    }
  }

  // Add the user's local video
  let localVideo = document.createElement("video");
  localVideo.setAttribute("id", "localVideo");
  localVideo.muted = true;
  localVideo.autoplay = true;
  localVideo.playsinline = true;
  videoSquares[0][0].appendChild(localVideo);

  // Add the peer's remote video
  let remoteVideo = document.createElement("video");
  remoteVideo.setAttribute("id", "remoteVideo");
  remoteVideo.autoplay = true;
  remoteVideo.playsinline = true;
  videoSquares[1][0].appendChild(remoteVideo);

  // Add the user ID input listener
  document.querySelector('#userName').oninput =
    e => document.querySelector('#cameraBtn').disabled = false;

  // Add all the button click event listeners
  document.querySelector('#cameraBtn').onclick = openUserMedia;
  document.querySelector('#createBtn').onclick = () => {
    document.querySelector('#createBtn').disabled = true;
    document.querySelector('#joinBtn').disabled = true;
    createRoom('magic8');
  };
  document.querySelector('#joinBtn').onclick = () => {
    document.querySelector('#createBtn').disabled = true;
    document.querySelector('#joinBtn').disabled = true;
    document.querySelector('#confirmJoinBtn').onclick = async () => {
      roomName = document.querySelector('#room-id').value;
      document.querySelector('#currentRoom').innerText = 
        `Current room is ${roomName} - You are the callee!`;       
      await joinRoom(roomName);
    };
    roomDialog.open();
  };
  document.querySelector('#hangupBtn').onclick = hangUp;
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));
}

initDomElements();