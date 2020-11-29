/**********************************************************************************
 * Organization of data in Cloud Firestore
 **********************************************************************************/
rooms (collection):
    roomIds (doc):
        nextRoomNum (field): 2
        roomNames (field): { 'famlee': 'ROOM0', 'magic8': 'ROOM1'}
    ROOM0 (doc):
        roomName (field): 'famlee'
        nextUserNum (field): 3
        userIds (field): ['USER0', 'USER1', 'USER2']
        userSettings (collection):
            userNames (doc): { USER0: 'priscilla', USER1: 'phoebe', USER2: 'emma' }
            userTiles (doc):
                isTileAvailable (field): {
                    0: [ false, false, false, true ]
                    1: [ true , true , true , true ]
                    2: [ true , true , true , true ]
                }
                USER0 (field): { row: 0, col: 0}
                USER1 (field): { row: 0, col: 1}
                USER2 (field): { row: 0, col: 2}
        fromUSER0 (collection):
            toUSER1 (doc):
                offer (field): { sdp: "<gibberish>", type: "offer" }
                callerCandidates (collection)
                answer (field): { sdp: "<gibberish>", type: "answer" }
                callerCandidates (collection)
            toUSER2 (doc)
        fromUSER1 (collection):
            toUSER0 (doc)
            toUSER2 (doc)
        fromUSER2 (collection):
            toUSER0 (doc)
            toUSER1 (doc)
    ROOM1 (doc):
        roomName (field): 'magic8'
        nextUserNum (field): 1
        userIds (field): ['USER0']
        userSettings (collection):
            userNames (doc): { USER0: 'priscilla' }
            userTiles (doc):
                isTileAvailable (field): {
                    0: [ false, true , true , true ]
                    1: [ true , true , true , true ]
                    2: [ true , true , true , true ]
                }
                USER0 (field): { row: 0, col: 0}
        fromUSER0 (collection)
