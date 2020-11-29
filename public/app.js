/**
 * Organization of data in Cloud Firestore...
 * 
 * - rooms (collection):
 *   - roomIds (doc):
 *       - nextRoomNum (field): 2
 *       - roomNames (field): { 'famlee': 'ROOM1', 'magic8': 'ROOM2'}
 *   - ROOM0 (doc):
 *       - roomName (field): 'famlee'
 *       - nextUserNum (field): 3
 *       - userIds (field): ['USER0', 'USER1', 'USER2']
 *       - userSettings (collection):
 *           - userNames (doc): { USER0: 'priscilla', USER1: 'phoebe', USER2: 'emma' }
 *           - userTiles (doc):
 *               - isTileAvailable (field): {
 *                    0: [ false, false, false, true ]
 *                    1: [ true , true , true , true ]
 *                    2: [ true , true , true , true ]
 *                 }
 *               - USER0 (field): { row: 0, col: 0}
 *               - USER1 (field): { row: 0, col: 1}
 *               - USER2 (field): { row: 0, col: 2}
 *       - fromUSER0 (collection):
 *           - toUSER1 (doc):
 *               - offer (field): { sdp: "<gibberish>", type: "offer" }
 *               - callerCandidates (collection)
 *               - answer (field): { sdp: "<gibberish>", type: "answer" }
 *               - callerCandidates (collection)
 *           - toUSER2 (doc)
 *       - fromUSER1 (collection):
 *           - toUSER0 (doc)
 *           - toUSER2 (doc)
 *       - fromUSER2 (collection):
 *           - toUSER0 (doc)
 *           - toUSER1 (doc)
 *   - ROOM1 (doc):
 *       - roomName (field): 'magic8'
 *       - nextUserNum (field): 0
 *       - userIds (field): []
 *       - userSettings (collection)
 */


const configuration = {
  iceServers: [
    {
      urls: [
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
      ],
    },
  ],
  iceCandidatePoolSize: 10,
};

const MAX_BITRATE = 250000;
const SCALE_RESOLUTION_DOWN_BY = 2;

let peerConnection = null;
let localStream = null;
let remoteStream = null;
let roomDialog = null;
let roomId = null;

const randomRoomIds = [
  'alligator', 'beaver', 'chipmunk', 'dolphin', 'elephant', 'flamingo', 'gorilla', 
  'hippo', 'iguana', 'jellyfish', 'kangaroo', 'llama', 'monkey', 'narwhal', 'octopus', 
  'penguin', 'quail', 'rhino', 'shark', 'turkey', 'unicorn', 'vulture', 'whale', 'zebra'
];

function init() {
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
  document.querySelector('#userId').oninput =
    e => document.querySelector('#cameraBtn').disabled = false;

  // Add all the button click event listeners
  document.querySelector('#cameraBtn').onclick = openUserMedia;
  document.querySelector('#createBtn').onclick = createRoom;
  document.querySelector('#joinBtn').onclick = joinRoom;
  document.querySelector('#hangupBtn').onclick = hangUp;
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));
}

async function openUserMedia(e) {
  const stream = await navigator.mediaDevices.getUserMedia(
      {video: true, audio: true});
  document.querySelector('#localVideo').srcObject = stream;
  localStream = stream;
  remoteStream = new MediaStream();
  document.querySelector('#remoteVideo').srcObject = remoteStream;

  document.querySelector('#cameraBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = false;
  document.querySelector('#createBtn').disabled = false;
  document.querySelector('#hangupBtn').disabled = false;

  // Display the user ID
  document.querySelector('#userId').disabled = true;
  var userId = document.querySelector('#userId').value;
  document.querySelector('#currentUser').innerText = `Current user is ${userId}`;
}

async function createRoom() {
  /********************************************************
   * Create the room (first user on the video call)
   ********************************************************/

  // Disable other buttons
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;

  // Create new room document
  const roomId = randomRoomIds[Math.floor(Math.random() * randomRoomIds.length)];
  const roomRef = await firebase.firestore().collection('rooms').doc(roomId);
  document.querySelector(
      '#currentRoom').innerText = `Current room is ${roomRef.id} - You are the caller!`;

  // Set up new peer connection, and send in local media stream
  peerConnection = new RTCPeerConnection(configuration);
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  // Collect local ICE candidates
  const callerCandidatesCollection = roomRef.collection('callerCandidates');
  peerConnection.onicecandidate = e => {
    if (e.candidate) {
      callerCandidatesCollection.add(e.candidate.toJSON());
    }
  };

  // Create a new peer connection offer
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  await roomRef.set({offer: { type: offer.type, sdp: offer.sdp }});

  // Downscale the video resolution and bitrate before sending to peer
  let videoSender = peerConnection.getSenders().find(s => s.track.kind === 'video');
  let params = videoSender.getParameters();
  if (!params.encodings) { params.encodings = [{}]; }
  params.encodings[0].scaleResolutionDownBy = SCALE_RESOLUTION_DOWN_BY;
  params.encodings[0].maxBitrate = MAX_BITRATE;
  await videoSender.setParameters(params);

  /********************************************************
   * Wait for other user(s) to join 
   ********************************************************/

  // Listen for remote session description
  roomRef.onSnapshot(async snapshot => {
    const data = snapshot.data();
    if (!peerConnection.currentRemoteDescription && data && data.answer) {
      const rtcSessionDescription = new RTCSessionDescription(data.answer);
      await peerConnection.setRemoteDescription(rtcSessionDescription);
    }
  });

  // Listen for remote ICE candidates
  roomRef.collection('calleeCandidates').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
      if (change.type === 'added') {
        await peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
      }
    });
  });

  // Listen to receive peer's remote stream over WebRTC P2P
  peerConnection.ontrack = e => {
    e.streams[0].getTracks().forEach(track => {
      remoteStream.addTrack(track);
    });
  };
}

function joinRoom() {
  // Diable other buttons
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;

  document.querySelector('#confirmJoinBtn').onclick = async () => {
    roomId = document.querySelector('#room-id').value;
    document.querySelector(
        '#currentRoom').innerText = `Current room is ${roomId} - You are the callee!`;       
    await joinRoomById(roomId);
  };
  roomDialog.open();
}

async function joinRoomById(roomId) {
  // Get room document by ID
  const roomRef = firebase.firestore().collection('rooms').doc(`${roomId}`);
  const roomSnapshot = await roomRef.get();

  if (roomSnapshot.exists) {
    // Set up new peer connection, and send in local media stream
    peerConnection = new RTCPeerConnection(configuration);
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    // Collect local ICE candidates
    const calleeCandidatesCollection = roomRef.collection('calleeCandidates');
    peerConnection.onicecandidate = e => {
      if (e.candidate) {
        calleeCandidatesCollection.add(e.candidate.toJSON());
      }
    };

    // Listen to receive peer's remote stream over WebRTC P2P
    peerConnection.ontrack = e => {
      e.streams[0].getTracks().forEach(track => {
        remoteStream.addTrack(track);
      });
    };

    // Create SDP answer for the initial offer
    const offer = roomSnapshot.data().offer;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await roomRef.update({answer: { type: answer.type, sdp: answer.sdp }});

    // Downscale the video resolution and bitrate before sending to peer
    let videoSender = peerConnection.getSenders().find(s => s.track.kind === 'video');
    let params = videoSender.getParameters();
    if (!params.encodings) { params.encodings = [{}]; }
    params.encodings[0].scaleResolutionDownBy = SCALE_RESOLUTION_DOWN_BY;
    params.encodings[0].maxBitrate = MAX_BITRATE;
    await videoSender.setParameters(params);

    // Listen for remote ICE candidates
    roomRef.collection('callerCandidates').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          await peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
        }
      });
    });
  }
}

async function hangUp(e) {
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

init();