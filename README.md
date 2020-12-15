# VideoTiles

Try it out at https://video-tiles.web.app :upside_down_face: !

> :warning: Only works on Google Chrome (not Firefox, Safari, or Edge)

> :warning: Only meant for desktop (not phones or tablets)

> :warning: Can't typically handle ~10 or more people (might even start failing
at 6 or 7 people)

## Table of Contents

* [The Idea](#the-idea)
* [How to Use](#how-to-use)
  * [Create / Join a Room](#create--join-a-room)
  * [Click to Move](#click-to-move)
  * [Proximity-Based Volume](#proximity-based-volume)
  * [Grid Layout & Private Rooms](#grid-layout--private-rooms)
  * [Arrow Keys to Move](#arrow-keys-to-move)
* [Implementation](#implementation)
  * [WebRTC](#webrtc)
  * [Firebase](#firebase)
  * [Bootstrap](#bootstrap)

## The Idea

Have you ever been stuck in an awkward group video call? Like a Zoom birthday
party with a bunch of people you'd never met before? Or a huge Zoom family
reunion where you had to take turns talking one by one?

I found it hard to connect with my friends and family over group calls because
my go-to video chat apps (e.g. Zoom, Facebook Messenger, Google Meets) didn't
support the social group dynamics that I was used to in the physical world. For
example, I wished we could:

* Have **multiple conversations** going at the same time
* Naturally **move and form clusters** around those conversations
* Hear the conversations closest to you most clearly
* Overhear the joy and laughter of a nearby conversation

I couldn't find an existing video chat app that accomplished 
this[<sup><b>(1)</b></sup>](#footnote), so I decided to take a stab at it
myself. I now present to you [VideoTiles](https://video-tiles.web.app), my
very, *very* rudimentary proof of concept video chat app.

## How to Use

### Create / Join a Room

The interface is fairly simple. All you need to do is:

0. Enable your camera and microphone
1. Create a room (with whatever username or room name you want)
2. Have 1 or more friends join your room (using the same room name that you
used)
3. Start chatting!

![Create and join a room](screenshots/create_and_join.png)

### Click to Move

You can simply use your mouse to click any tile in the grid to move to it.

![Click to move](screenshots/click_to_move.gif)

### Proximity-Based Volume

The color of a person's tile represents the volume at which you'll hear them.
For example, if a person's tile is...

* The lightest blue (closest to you), you'll hear them at full volume
* Medium blue (nearby to you), you'll hear them at half volume
* Dark blue (far from you), you'll hear them at very low volume
* The darkest blue (farthest from you), you won't be able to hear them at all

![Proximity-based volume](screenshots/proximity_volume.png)

### Grid Layout & Private Rooms

The entire grid is 7x15 (7 rows tall and 15 columns wide). The grid is not
meant to fit within a laptop (or even monitor) screen. But you can always
**zoom out** if you want to get a bird's eye view of the entire space.

![Zoom out](screenshots/zoom_out.png)

Each of the grid's four corners has a 2x4 **"private room"**. Private rooms 
have **all-or-nothing** audio. That is, only people within a given private
room will be able to hear each other. Anybody outside the private room will not
be able to hear anything inside.

The layout of the grid allows natural conversation clusters to form. For
example, you could have a few groups of people chatting at varying volume
levels. 

![Examples of clusters](screenshots/cluster_examples.png)

### Arrow Keys to Move

In addition to being able to click to move, you may also use the arrow keys on
your keyboard to move around.

![Use arrow keys to move](screenshots/arrows_to_move.gif)

## Implementation

### WebRTC

I built the video chat using [WebRTC](https://webrtc.org/), an open-source
project that supports real-time video and voice. [This 45 min talk from Google
I/O 2013](https://www.youtube.com/watch?v=p2HzZkd2A40) is a great introduction
to WebRTC. To get started, I relied heavily on these [WebRTC
samples](https://webrtc.github.io/samples/). The [WebRTC API
documentation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
was also super useful. 

I started by setting up a simple fully-connected peer-to-peer mesh architecture
(Read [BlogGeek's post](https://bloggeek.me/webrtc-multiparty-architectures/)
to learn about WebRTC multiparty architectures). This was the easiest option
because it didn't require a media server. However, the mesh architecture is
[known to be terribly inefficient](https://bloggeek.me/webrtc-p2p-mesh/). It
doesn't scale well and can struggle with groups as small as ~4 users.

I considered upgrading to an [SFU (selective forwarding unit) media
server](https://bloggeek.me/webrtc-multiparty-video-alternatives/) to improve
performance for large groups, but I decided it wasn't worth the investment for
this proof of concept. Instead, I found that [Nick Gauthier of
MeetSpace](https://youtu.be/X2gLy4QRK9k) was able to run a 10-way mesh call
over WebRTC by severely restricting the bandwidth of each peer connection. He
constrained the frame size, frame rate, and bit rate of each user's video and
posted [an article on
webrtcH4cKS](https://webrtchacks.com/limit-webrtc-bandwidth-sdp/) describing
how he modified SDPs to achieve this.

So I crippled the video quality of VideoTiles hoping that it will be able to
handle ~10-way mesh group calls. But honestly, I haven't been able to test it
out. But if you have enough friends and/or devices to try it out, please let
me know if you have any success!

### Firebase

VideoTiles wouldn't have been possible without
[Firebase](https://firebase.google.com/), Google's platform that helps
developers create mobile and web applications. In fact, Firebase teamed up
with WebRTC to provide an *amazing* [Firebase + WebRTC
codelab](https://webrtc.org/getting-started/firebase-rtc-codelab)! It was so
easy to get started. I literally copied and pasted the code and had a video
chat app up and running within an hour!

I also think Firestore's documentation is incredible. I heavily relied on the
[Cloud Firestore documentation](https://firebase.google.com/docs/firestore).

### Bootstrap

For styling, I used [Bootstrap v4.5](https://getbootstrap.com/docs/4.5)
to throw together a quick layout. I used a couple of their components such as
their buttons and toasts.

## Footnotes
<div id="footnote">
 <p>
  <span><sup><b>(1)</b></sup><sp></span>
  I later learned of this <i>incredible</i> video chat app called
  <b>Gather</b> (https://gather.town/). It's completely FREE and supports all
  the features I wanted and more! I highly recommend that you try it out with
  friends and family!
 </p>
</div>
