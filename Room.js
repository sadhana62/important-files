/*
*Author: Sohom
*Description: Class Room represents a VCX Room. It will handle the connection, local stream publication and
 *            remote stream subscription.
 * Typical Room shall initilized: var room = Client.Room({token:'213h8012hwduahd-321ueiwqewq'});
 * It also handles RoomEvents and StreamEvents. For example:
 * Event 'room-connected' refers that the user has been successfully connected to the room.
 * Event 'room-disconnected' refers that the user has been already disconnected.
 * Event 'stream-added' refers that there is a new stream available in the room.
 * Event 'stream-removed' refers that a previous available stream has been removed from the room.
 *Version: V 1.0
 */
 import Connection from './Pair';
 import { EventDispatcher, StreamEvent, RoomEvent, UserEvent, PublisherEvent } from './Events';
 import { Socket } from './Socket';
 import Stream from './Stream';
 import BreakOutRoom from './BreakOutRoom';
 import Element from './views/Element';
 import VcxRtcMap from './utils/VcxRtcMap';
 import Base64 from './utils/Base64';
 import Logger from './utils/Logger';
 import VcxEvent from './vcxEventProperties';
 import customErrors from './customErrors';
 import config from './../Common.config';
 import customEvents from './customEvents';
 import EL from './EventLogger';
 // file sharing
 import { setFileShareServiceEndPoint, getConstants } from './fileShare/app/api';
 import FileSender from './fileShare/app/fileSender';
 import Archive from './fileShare/app/archive';
 import FileReceiver from './fileShare/app/fileReceiver';
 import Annotate from './annotate';
 
 const statsIcon = '<svg  viewBox="0 0 16 16" width="16" height="16" xml:space="preserve" fill="green"><rect height="6" width="4" y="10"/><rect height="10" width="4" x="6" y="6"/><rect height="16" width="4" x="12"/></svg>';
 const USER = "user";
 const OWNER = "owner";
 const ROOM = "room";
 const SESSION = "session";
 const SCOPE = [USER,OWNER, ROOM, SESSION];
 let localMediaStreamInUse = true;
 let localVideoStreamATStateBw;
 
 window.statsIcon = statsIcon;
 
 const Room = (altIo, altConnection, specInput) => {
     if (!config.is_supported()) {
         Logger.info('Failed - Webrtc support is missing ');
         return undefined;
     }
     const that = EventDispatcher(specInput);
     const DISCONNECTED = 0;
     const CONNECTING = 1;
     const CONNECTED = 2;
     const DISCONNECTING = 3;
     let detectInternetStatus;
     // default reconnectInfo parameters
     const defReconnectInfo = {
         allow_reconnect: true, number_of_attempts: 3, timeout_interval: 45000,
     };
     // file receive test
     that.filesToUpload = [];
     that.f2rec = {};
     that.availableFiles = [];
     const uploadsInProgress = new Map();
     const downloadsInProgress = new Map();
 
     const shFileList = [];
     let maxFileSize = 10 * 1024 * 1024;
     const fileShareUI = {
         enable: false,
         uploadElToAppend: '',
         recvElToAppend: '',
     };
     that.showFsUi = false;
     // end ft test
     const spec = specInput;
     that.internetDetectionUrl = config.internetDetectionUrl; // ajax resource url to detect the network
     that.remoteStreams = VcxRtcMap();
     that.localStreams = VcxRtcMap();
     that.roomID = '';
     that.talkerCount = 0;
     that.userAudioTalkerCount = 0;
     that.userVideoTalkerCount = 0;
     that.state = DISCONNECTED;
     that.allStreamsActive = false;
     that.streamsHealthTimerId = 0;
     that.Connection = altConnection === undefined ? Connection : altConnection;
     that.receiveVideoQuality = new Map();
     that.receiveVideoQuality.set('talker', 'Auto');
     that.receiveVideoQuality.set('canvas', 'HD');
     that.mediaStatsMode = 'disable';
     that.liveTranscription= false;
 
     let socket = Socket(altIo);
     that.socket = socket;
     that.userList = new Map();
     that.dialOutList = new Map();
     that.cControlReq = undefined;
     that.cCrequest = [];
     that.awaitedParticipants = new Map();
     that.floorGranted = false;
     that.floorInvited = false;
     that.floorAccepted = false;
     that.roomJson = undefined;
     that.clientId = undefined;
     that.mode = undefined;
     that.activeTalker = false;
     that.shareStatus = false;
     that.share_override_room = false;
     that.shareOverRide = false;
     that.shareOverRideCallback = undefined;
     that.isOverRidingShare = false;
     that.ScreenSharelocalStream = null;
     that.isSharingClient = false;
     that.forcedStopSharing = false;
     that.isCanvasSharing = false;
     that.isCanvasSharingClient = false;
     that.canvasStatus = false;
     that.activeTalkerList = new Map();
     that.audioOnlyMode = false;
     that.roomMuted = false;
     const token = JSON.parse(Base64.decodeBase64(spec.token));
     that.reconnectionState = false; //  reconnection
     that.reconnectAttempt = 0;
     that.connectAttempt = 0;
     let MAXRECONNECTIONATTEMPT = 3;//  kept high value for testing it needs to be changed
     let MAXCONNECTIONATTEMPT = 7;//  kept high value for testing it needs to be changed
     that.isStreamingClient = false;
     that.sendRecvBitrateStats = false;
     that.selectedSpeakerId = (specInput != undefined && specInput.speakerId != undefined) ?
         specInput.speakerId : undefined;
     let localRecord = 'none';
     const avOptions = {
         publish: { forceTurn: false },
         subscribe: { forceTurn: false, imageOnVideoMute: false },
     };
     const sharePublishOptions = { forceTurn: false };
     const canvasPublishOptions = { forceTurn: false };
     if (spec.hasOwnProperty('reconnectInfo')) {
         Logger.info('reconnect parameter', spec.reconnectInfo);
         that.reconnectionAllowed = spec.reconnectInfo.allow_reconnect;
         that.reconnectionTimeOutInterval = spec.reconnectInfo.timeout_interval;
         MAXRECONNECTIONATTEMPT = spec.reconnectInfo.number_of_attempts;
     } else {
         //  if reconnect params are not  present in the spec info
         that.reconnectionAllowed = defReconnectInfo.allow_reconnect;
         that.reconnectionTimeOutInterval = defReconnectInfo.timeout_interval;
         MAXRECONNECTIONATTEMPT = defReconnectInfo.number_of_attempts;
     }
     const reconStartTime = 0;
     let roomRecordStatus = false;
     let prefNumTakler = -1;
     that.localStreamsBeforeReconnect = VcxRtcMap();// store all local streams in this before reconnect
     that.oldSpecInfo = undefined;
     that.mediaConfiguration = token.roomMeta.settings.media_configuration ?
         token.roomMeta.settings.media_configuration : 'Default';
     that.maxVideoLayers = 0;
     that.defaultBandwidth = new Map();
     that.defaultBandwidth.set(1, 200000);
     that.defaultBandwidth.set(2, 300000);
     that.defaultBandwidth.set(3, 400000);
     that.defaultBandwidth.set(4, 600000);
     that.defaultBandwidth.set(5, 800000);
     that.defaultBandwidth.set(6, 1000000);
     that.defaultBandwidth.set(7, 1200000);
 
     that.videoMutedUsers = {};
     let mediaConnectionTimer;
     let remoteStreams = that.remoteStreams;
     let localStreams = that.localStreams;
     let locStrm;
     that.hardMuteRoom = false;
     const breakOutRoom = BreakOutRoom(null, null);
     that.breakOutRoom = breakOutRoom;
     that.me = {};
     that.roomSettings = {};
     that.mute = false;
     that.muteAudioOnJoin = false;
     that.muteVideoOnJoin = false;
     //that.mute = {room: false, audioOnJoin: false, videoOnJoin: false};
     that.cCapprovedHands = [];
     that.externalIp = '';
     let peerStatsInterval;
     that.subscribeSessionStats = false; // session stats display
 
     that.canvasOptions = { width: 1280, height: 720, domHandle: '' };
     that.inputContext = null;
     that.canvasVideoPlayer = '';
     const videoResolutionRange = config.video_resolution_range[token.roomMeta.settings.quality];
     const statsStyle = document.createElement('style');
     const statsCss = `.stats-container{ 
                          position: absolute;
                          z-index: 5;
                          padding: 2px;
                          top: 2px;
                          right: 2px;
                          font-size: 12px;
                          width: 22px;
                          height: 22px;
                          text-align: center;
                          background: white;
                          border-radius: 10px;
                      }
                      .stats-button{
                          cursor:pointer;
                          width: 15px;
                          height: 15px;
                          padding: 0 0 0 2px;
                      }
                      .stats-detail{ height: 100%;}
                      .stats-overlay-inner{
                          display: flex;
                          flex-direction: row;
                          justify-content: space-between;
                          padding: 8px 2px 6px 10px;
                      }
                      .stats-right-partition, .stats-left-partition {}
                      .stats-left-partition {margin-right: 10px;}
                      .stats-button svg {width: 12px;height: 12px;}
                          `;
     statsStyle.innerHTML = statsCss;
 
     const bwNotificationStyle = document.createElement('style');
     const bwNotificationCSS = `.bw-notification{
                                  position: absolute;
                                  //z-index: 5;
                                  top:50%;
                                  left:50%;
                                  margin-top:-50px;
                                  margin-left:-100px;
                                  padding: 5px;
                                  color: #fff;
                                  background: rgba(50,50,50,0.5);
                                  }`;
     bwNotificationStyle.innerHTML = bwNotificationCSS;
     let isAnnotationStarted = false;
     let isCaptchaStarted = false;
     let isIceSuccess = false;
     let t =0;
     let videoPlaying = true;
     let tt =0;
 
     /*Descirption: Private functions removeStream used to release a strem from a socket
       * Used in: socketOnRemoveStream
       * */
     const removeStream = (streamInput) => {
         const stream = streamInput;
         console.log (" in Remove stream : stream.stream : " + stream.stream);
         if (stream.stream) {
             // Remove HTML element
             stream.hide();
 
             stream.stop();
             stream.close();
             delete stream.stream;
         }
 
         // Close PC stream
         if (stream.pc) {
             stream.pc.close();
             delete stream.pc;
         }
     };
 
     const onStreamFailed = (streamInput, message) => {
         const stream = streamInput;
 
         if ((that.socket.state !== DISCONNECTED) && (that.reconnectionState === false)) {
             if (!stream.reconnect && stream.reconnectAttempt < MAXRECONNECTIONATTEMPT){
               Logger.info(' onStreamFailed() ' + (stream.local ? 'publisher' : 'subscriber') + ' streamId: ' + stream.getID() + 
                           ' - wait for individual reconnection : num reconnect attempts: ' + stream.reconnectAttempt);
               reconnectStream (stream);
             }else if (!stream.reconnect){
               Logger.info('onStreamFailed() ' + (stream.local ? 'publisher' : 'subscriber') + ' streamId: ' + stream.getID() + 
                           ' - reconnect attemt exceeded close socket and reconnection');
               EL.error('room-event', customEvents.event_ice_failed, { error: 'close the socket and wait for reconnection', stream });
               stream.reconnect = false;
               stream.reconnectRetries = 0;
               if (stream.local) {
                   Logger.info('Local stream  failed - close the socket and wait for reconnection');
                   that.socket.disconnect();
               }
             }
         }
 
         if (that.state !== DISCONNECTED && !stream.reconnect && !stream.failed && that.reconnectionAllowed === false) {
             Logger.info('onStreamFailed() failed - unpublishing and unsubscibing the stream');
             EL.error('room-event', customEvents.event_ice_failed, { error: 'unpublishing and unsubscibing the stream', stream });
 
             stream.failed = true;
             const streamFailedEvt = StreamEvent({
                 type: 'stream-failed',
                 msg: message || 'Stream failed after connection',
                 stream,
             });
             that.dispatchEvent(streamFailedEvt);
             if (stream.local) {
                 that.unpublish(stream);
             } else {
                 that.unsubscribe(stream);
             }
         }
     };
 
     /*
      *Descirption: Private functions dispatchStreamSubscribed used
      * to notify when stream get subscribed
      * Used in: createRemoteStreamConnection
      * */
     const dispatchStreamSubscribed = (streamInput, evt) => {
         const stream = streamInput;
         let peerStatsIntervalSubs;
         // Draw on html
         Logger.info('Stream subscribed');
         if (evt.stream) {
             stream.initRemoteStream(evt.stream);
             that.remoteStreams.remove(stream.getID());
             that.remoteStreams.add(stream.getID(), stream);
         }
 
         const evt2 = StreamEvent({ type: 'stream-subscribed', stream });
         that.dispatchEvent(evt2);
 
         // put reconnect condition
         // Play the stream if player is available but stream is paused
         stream.room = that;
         if (stream.screen === true || stream.canvas === true) {
             stream.updateVideo(stream.getID());
         }
 
         const getPeerData = (result) => {
             if (result) {
                 //    clearInterval(peerStatsIntervalSubs);
                 const additionalOptions = {
                     streamType: stream.ifScreen() ? 'share' : 'main',
                     streamId: stream.getID(),
                     selectedCandidates: result.selectedCandidates,
                     negotiatedCodecs: {
                         video: {
                             codec: (that.mediaConfiguration === 'default' || that.mediaConfiguration === 'Default') ? 'VP8' : that.mediaConfiguration,
                         },
                         audio: {
                             codec: 'OPUS',
                         },
                     },
                     externalIp: that.externalIp,
                 };
                 that.createEventLog('clientStreamSubscribeSuccess', additionalOptions);
             }
         };
         /*   if(stream.pc) {
                peerStatsIntervalSubs = setInterval(() => {
                    getPeerStats(stream.pc.peerConnection, getPeerData);
                }, 1000);
            } */
     };
 
     /*
           *Descirption: Private functions removeLocalStreamConnection used
           * to release local stream connection i.e socket
           * Used in: socketOnUnpublishMe
           * */
 
     const getVcxRtcConnectionOptions = (stream, options, isRemote) => {
         const connectionOpts = {
             callback(message) {
                 Logger.info('Sending message', message);
                 socket.sendSDP('signaling_message', {
                     streamId: stream.getID(),
                     msg: message,
                     browser: stream.pc.browser,
                 }, undefined, () => { });
             },
             nop2p: true,
             audio: options.audio && stream.ifAudio(),
             video: options.video && stream.ifVideo(),
             maxAudioBW: options.maxAudioBW,
             maxVideoBW: options.maxVideoBW,
             limitMaxAudioBW: spec.maxAudioBW,
             limitMaxVideoBW: spec.maxVideoBW,
             iceServers: that.iceServers,
             forceTurn: stream.forceTurn,
         };
         if (!isRemote) {
             connectionOpts.simulcast = options.simulcast;
         }
         return connectionOpts;
     };
     const checkAndProcessStreamsHealth = () => {
       if (that.state != CONNECTED || !that.allStreamsActive){
         return;
       }
 /*
       let health = true;
       let streams = remoteStreams.getAll();
       const keys = Object.keys(streams);
       for (let index = 0; index < keys.length; index += 1) { 
         if (checkStreamState(streams[keys[index]]) == false) {
           health = false;
           break;
         }
       }
       if (!health) that.reJoinRoom();
 */
 
       remoteStreams.forEach((stream, id) => {
         if (that.state == CONNECTED){
           if (checkStreamState(stream) == false){
             if (!stream.reconnect && stream.reconnectAttempt < MAXRECONNECTIONATTEMPT){
               reconnectStream(stream);
             }else if (!stream.reconnect && stream.reconnectAttempt >= MAXRECONNECTIONATTEMPT){
               that.reJoinRoom();
             }
           }
         }
       });
       localStreams.forEach((stream, id) => {
         if (that.state == CONNECTED){
           if (checkStreamState(stream) == false){
             if (!stream.reconnect && stream.reconnectAttempt < MAXRECONNECTIONATTEMPT){
               reconnectStream(stream);
             }else if (!stream.reconnect && stream.reconnectAttempt >= MAXRECONNECTIONATTEMPT){
               //that.reJoinRoom();
               that.socket.disconnect();
             }
           }
         }
       });
     }
 
     const checkStreamState = (stream) => {
       let result = true;
       if(stream){
         const checkTrackState = (mediaStream) => {
           let tracks = mediaStream.getTracks();
           let ready = true;
           for(const track of tracks) {
             if(track.enabled === true){
               if (track.readyState === 'live') {
                 Logger.debug("Stream state is ready");
               } else {
                 Logger.info("Track state is not ready State: " + track.readyState);
                 ready = false;
               }
             }else {
               Logger.info("Track state not ready ,track not anabled " );
             }
           }
           return ready;
         }
         if (stream.audioStream) result = checkTrackState(stream.audioStream);
         if (result && stream.videoStream) result = checkTrackState(stream.videoStream);
       }
       return result;
     };
 
     const createRemoteStreamVcxRtcConnection = (streamInput, options) => {
         const stream = streamInput;
         stream.pc = that.Connection.buildPair(getVcxRtcConnectionOptions(stream, options, true));
         Logger.info(`Create remote connection for subscribe:-${JSON.stringify(options)}`);
         stream.pc.onaddstream = dispatchStreamSubscribed.bind(null, stream);
         Logger.info("Registering the peer connection timer for the subscriber stream " + stream.getID());
         setTimeout(checkStreamState, 10000, stream);
         const handleConnectionStateChange = (state, source) => {
             console.log (" stream state ICE remote id - " + stream.getID() + " : " + state + " source: " + source);
             if (state === 'failed' || (state === 'disconnected' && source == "pc")) {
                 stream.reconnect = false;
                 Logger.info(source + " connection state failed - streamId: " + stream.getID());
                 console.log (" stream state "+ source + " connection remote id - " + stream.getID() + " : failed");
                 onStreamFailed(stream);
                 EL.error('room-event', customEvents.event_ice_failed, { error: {} });
             } else {
                 Logger.info('stream ID', stream.getID());
                 Logger.info('ice connection state', state);
                 if (state === 'connected') {
                   console.log (" stream state ICE remote id - " + stream.getID() + " : ICE connected");
                   Logger.info("ice connection state connected - streamId : " + stream.getID());
                   EL.info('room-event', customEvents.event_ice_success, { message: 'ICE connected successfully' });
                   if (stream.reconnect){
                     stream.reconnect = false;
                     stream.reconnectAttempt = 0;
                     let atEntry = that.activeTalkerList.get(stream.getID());
                     if (atEntry){
                       if (atEntry.mediatype != 'none'){
                         let atInfo = JSON.parse(JSON.stringify(atEntry));
                         atInfo.mediatype = 'none'
                         stream.reloadPlayer(atInfo, avOptions.subscribe.imageOnVideoMute);
                       }
                       stream.reloadPlayer(atEntry, avOptions.subscribe.imageOnVideoMute);
                     }else {
                       console.log (" stream state ICE remote id - " + stream.getID() + " : ICE reconnected ");
                     }
                   }
                 }
             }
         };
         stream.pc.oniceconnectionstatechange = (state) => { handleConnectionStateChange(state,"ice");};    
         stream.pc.onconnectionstatechange = (state) => {handleConnectionStateChange(state, "pc")};        
 
         stream.pc.createOffer(true);
     };
     const reconnectStream =  (stream) => {
       let inputOptions = stream.userRequestOptions;
       stream.reconnect = true;
       stream.reconnectAttempt++;
       if (stream.local){
         Logger.info('reconnectStream()  streamId: ' + stream.getID() + ' calling unpublish()'); 
         that.unpublish(stream, (result, error) => { 
           Logger.info('reconnectStream()  streamId: ' + stream.getID() + ' unpublish callback calling publish()'); 
           that.publish(stream, inputOptions, () => { 
             Logger.info('reconnectStream()  streamId: ' + stream.getID() + ' publish callback');
           });
         });
       }else {
         Logger.info('reconnectStream()  streamId: ' + stream.getID() + ' calling unsubscribe()'); 
         that.unsubscribe(stream, (result, error) => {
           Logger.info('reconnectStream()  streamId: ' + stream.getID() + ' unsubscribe callback calling publish()'); 
           that.subscribe(stream,inputOptions, () => { 
             Logger.info('reconnectStream()  streamId: ' + stream.getID() + ' subscribe callback');
           });
         });
       }
     };
     that.reconnectStream = (stream) =>{
       console.log ("calling reconnect stream");
       reconnectStream(stream);  
     }
 
     that.notifyDeviceUpdate = () => {
         Connection.mediaDeviceUpdate((res) => {
             const evt = RoomEvent({ type: 'user-media-device-list-change', message: res.added });
             that.dispatchEvent(evt);
         });
     };
 
     const createLocalStreamVcxRtcConnection = (streamInput, options) => {
         const stream = streamInput;
         stream.pc = that.Connection.buildPair(getVcxRtcConnectionOptions(stream, options));
         if (stream.audioStream) {
             for (const track of stream.audioStream.getAudioTracks()) {
                 stream.pc.addTrack(track);
             }
         }
         if (stream.videoStream) {
             for (const track of stream.videoStream.getVideoTracks()) {
                 stream.pc.addTrack(track);
             }
         }
         Logger.info("Registering the peer connection timer for the subscriber stream " + stream.getID());
         setTimeout(checkStreamState, 10000, stream);
         const handleConnectionStateChange = (state, source) => {
             let streamType = stream.ifCanvas() ? "canvas" : stream.ifScreen() ? "screen" : "main";
             if (state === 'failed' || (state === 'disconnected' && source == "pc")) {
               stream.reconnect = false;
               console.log (" stream state local  " + streamType + " : " + state + " source: " + source + " calling onStreamFailed stream.reconnect: " + stream.reconnect);
                 onStreamFailed(stream);
             }else if (state === 'connected'){
               stream.reconnect = false;
               stream.reconnectAttempt = 0;
               console.log (" stream state local  " + streamType + " : " + state + " source: " + source);
             }
             Logger.info('handleConnectionStateChange state:', state);
         };
         stream.pc.oniceconnectionstatechange = (state) => { handleConnectionStateChange (state, "ice");};
         stream.pc.onconnectionstatechange = (state) => { handleConnectionStateChange (state, "pc");};
 
         if (!options.createOffer) { stream.pc.createOffer(); }
     };
 
     // We receive an event with a new stream in the room.
     // type can be "media" or "data"
 
     const socketOnAddStream = (arg) => {
         const stream = Stream(that.Connection, {
             streamID: arg.id,
             local: false,
             clientId: arg.clientId,
             audio: arg.audio,
             video: arg.video,
             data: arg.data,
             screen: arg.screen,
             attributes: arg.attributes,
         });
         stream.room = that;
         remoteStreams.add(arg.id, stream);
         const evt = StreamEvent({ type: 'stream-added', stream });
         EL.info('room-event', customEvents.event_general_success, { message: ('socketOnAddStream - stream added') });
         that.dispatchEvent(evt);
     };
 
     const socketOnRemoveTrack = (arg) => {
         const streamID = arg.id.streamId;
         const updatedSTream = Stream(that.Connection, { streamID });
         videoStop(streamID);
         const evt = RoomEvent({ type: 'track-removed', streams: [updatedSTream], message: `tracked removed from stream: ${streamID}` });
         EL.info('room-event', customEvents.event_general_success, { message: ('socketOnRemoveTrack - tracked removed from stream') });
         that.dispatchEvent(evt);
     };
 
     const userConnect = (arg) => {
         const userName = arg.name;
         const userRole = arg.role;
         const userPermissions = arg.permissions;
         const user = {
             name: arg.name,
             permissions: arg.permissions,
             role: arg.role,
             user_ref: arg.user_ref,
             videoMuted: arg.videoMuted,
             audioMuted: arg.audioMuted,
         };
         user.audioEnabled = arg.audioEnabled != undefined ? arg.audioEnabled : true;
         user.videoEnabled = arg.videoEnabled != undefined ? arg.videoEnabled : true;
         if (arg.data != undefined) user.data = arg.data;
         that.userList.set(arg.clientId, user);
         const evt = UserEvent({
             type: 'user-connected', name: userName, clientId: arg.clientId, role: userRole, 
             permission: userPermissions, user:user
         });
         if (that.awaitedParticipants.get(arg.clientId)) {
             that.awaitedParticipants.delete(arg.clientId);
         }
         EL.info('room-event', customEvents.event_room_user_connect_success, { message: ('userConnect - user connected') });
         that.dispatchEvent(evt);
     };
     const userUpdate = (arg) => {
       let user = that.userList.get(arg.clientId);
       if (user != undefined){
         if (arg.key == "media-modes"){
           if (arg.info != undefined && arg.info.publish != undefined){
             if (user.audioEnabled != arg.info.publish.audio){ 
               user.audioEnabled = arg.info.publish.audio;
               let evntType = user.audioEnabled ? 'user-audio-enabled' : 'user-audio-disabled';
               that.dispatchEvent(UserEvent({ type: evntType, clientId: arg.clientId }));
             }
             if (user.videoEnabled != arg.info.publish.video) {
               user.videoEnabled = arg.info.publish.video;  
               let evntType = user.videoEnabled ? 'user-video-enabled' : 'user-video-disabled';
               that.dispatchEvent(UserEvent({ type: evntType, clientId: arg.clientId }));
             }   
           }else{
             Logger.error('userUpdate() failed - filed missing for media-modes : ' + JSON.stringify(arg));
           }
         }else {
           Logger.error('userUpdate() failed - invalid key : ' + JSON.stringify(arg));
         }
       }else {
           Logger.error('userUpdate() failed - user not found : ' + JSON.stringify(arg));
       }
     };
 
     const userDisConnect = (arg) => {
         const userName = arg.name;
         const userRole = arg.role;
         const userPermissions = arg.permissions;
         const clientId = arg.clientId;
         that.userList.delete(arg.clientId);
         if ((that.isStreamingClient === true) && (that.userList.size === 0)) { // checking userList.size = 0 because streaming client won't be included in userList
             Logger.info('S.T. Client :true  and all users have disconnected');
             onRoomDisconnected('streaming-client-disconnect');
         }
         if (that.mode === 'lecture' && that.me.role === 'moderator'){
           checkAndRemoveGrantedFloor(clientId);
         }
         const evt = UserEvent({
             type: 'user-disconnected', name: userName, clientId, role: userRole, permission: userPermissions,
         });
         EL.info('room-event', customEvents.event_room_user_disconnect_success, { message: ('userDisConnect - user disconnected') });
         that.dispatchEvent(evt);
     };
 
     const userSubcribe = (arg) => {
         const userName = arg.name;
         const userRef = arg.user_ref;
         const userRole = arg.role;
         const socket = arg.socket;
         const evt = PublisherEvent({
             type: 'user-subscribed', name: userName, role: userRole, user_ref: userRef, socket,
         });
         EL.info('room-event', customEvents.event_general_success, { message: ('userSubcribe - user subscribed') });
         that.dispatchEvent(evt);
     };
 
     const userUnSubcribe = (arg) => {
         const userName = arg.name;
         const userRef = arg.user_ref;
         const userRole = arg.role;
         const socket = arg.socket;
         const evt = PublisherEvent({
             // @todo - should not it be user-unsubscribed
             type: 'user-subscribed', name: userName, role: userRole, user_ref: userRef, socket,
         });
         EL.info('room-event', customEvents.event_general_success, { message: ('userUnSubcribe - user unsubscribed') });
         that.dispatchEvent(evt);
     };
 
     const videoStop = (id) => {
         const screenSaver = Element.getById(`screen_saver_${id}`);
         const playBtn = Element.getByClass('icon_play', screenSaver.parentNode);
         playBtn.disabled = true;
         if (screenSaver && screenSaver.style.display === 'none') {
             screenSaver.style.display = 'block';
         } else if (screenSaver && screenSaver.style.display === 'block') {
             screenSaver.style.display = 'none';
         }
     };
 
     const socketOnVcxRtcMessage = (arg) => {
         let stream;
 
         if (arg.peerId) {
             stream = remoteStreams.get(arg.peerId);
         } else {
             stream = localStreams.get(arg.streamId);
         }
 
         if (stream && !stream.failed && stream.pc) {
             stream.pc.processSignalingMessage(arg.msg, that.mediaConfiguration);
             if (arg.msg && (typeof arg.msg === 'object') && (arg.msg.type === 'ready')) {
                 if (stream.local) {
                     discardLocalStreamForReconnect (stream.ifScreen(), stream.ifCanvas());
                     if (stream.ifCanvas()) {
                         Logger.info('canvas ready :: wb: ');
                         console.log (" stream state local canvas: ready");
                     } else if (!stream.ifScreen() && !stream.ifCanvas()) {
                         console.log (" stream state local main: ready");
                         let audioInfo;
                         let videoInfo;
                         if (that.maxVideoLayers > 1) {
                             const bitrates = {
                                 0: config.video_bandwidth_range[token.roomMeta.settings.quality][2].max * 1000,
                                 1: config.video_bandwidth_range[token.roomMeta.settings.quality][1].max * 1000,
                                 2: config.video_bandwidth_range[token.roomMeta.settings.quality][0].max * 1000,
                             };
                             Logger.info(`updating simulcast bps for quality: ${token.roomMeta.settings.quality} bitrates: ${JSON.stringify(bitrates)}`);
                             stream.updateSimulcastLayersBitrate(bitrates);
                         }
                         //if (that.mute && that.me.role === 'participant') {}
                         let raiseEvent = true;
                         audioInfo = {local: false, hard: false,eventInfo: undefined};
                         videoInfo = {local: false, hard: false,eventInfo: undefined};
                         
                         // hard-mute-room event not sending to app as  room mute sent in room-connected event
                         if (that.mute) audioInfo.hard |= true;
 
                         Logger.info("streamId: " + stream.getID() + " local cam Publish ready state");
 
                         if (that.videoMuteOnJoin != undefined) {
                           videoInfo.local |= that.videoMuteOnJoin.local;
                           videoInfo.hard |= that.videoMuteOnJoin.hard;
                           raiseEvent = false;
                           delete that.videoMuteOnJoin;
                         }
                         if (that.audioMuteOnJoin != undefined) {
                           audioInfo.local |= that.audioMuteOnJoin.local;
                           audioInfo.hard |= that.audioMuteOnJoin.hard;
                           raiseEvent = false;
                           delete that.audioMuteOnJoin;
                         }
                         audioInfo.local |= stream.config.audioMuted;
                         videoInfo.local |= stream.config.videoMuted; 
                         if (stream.video == false) videoInfo = { local: false, hard: false};
                         if (stream.audio == false) audioInfo = { local: false, hard: false};
                         mediaDeviceMuteOnJoin(stream, audioInfo, videoInfo, raiseEvent);
                         if (stream.config.audioMuted ) stream.config.audioMuted = false;
                         if (stream.config.videoMuted ) stream.config.videoMuted = false;
                     }else {
                       console.log (" stream state local share: ready");
                     }
                     stream.onStateChanged(true);
                 }else {
                   console.log (" stream state remote id - " + stream.getID() + " : ready");
                 }
             } else if (that.selectedSpeakerId != undefined) {
                 stream.setSpeaker(that.selectedSpeakerId);
             }
         }
     };
 
     const socketOnPeerMessage = (arg) => {
         let stream = localStreams.get(arg.streamId);
 
         if (stream && !stream.failed) {
             stream.pc.get(arg.peerSocket).processSignalingMessage(arg.msg);
         } else {
             stream = remoteStreams.get(arg.streamId);
             stream.pc.processSignalingMessage(arg.msg);
         }
     };
 
     const socketOnPublishMe = (arg) => {
         const myStream = localStreams.get(arg.streamId);
     };
 
     const socketOnUnpublishMe = (arg) => {
         const myStream = localStreams.get(arg.streamId);
     };
 
     const socketOnSelfBandwidthAlert = (arg) => {
         Logger.info('Received SocketOnSelfBandwidthAlert', JSON.stringify(arg));
         if (arg.message === 'SubscriberBandWidth') {
             const evt = RoomEvent({ type: 'room-bandwidth-alert', message: arg.bandwidth });
             that.dispatchEvent(evt);
         } else {
             localStreams.forEach((stream, id) => {
                 if (arg.bandwidth === 1) {
                     Logger.info('mute publisher video due to low bandwidth');
                     EL.info('room-event', customEvents.event_low_bandwidth_update,
                         { message: ('socketOnSelfBandwidthAlert - muted publisher video due to low bandwidth') });
                     stream.muteVideo();
                 } else {
                     if (arg.message === 'ShareBandwidth' && stream.screen) {
                         stream.setVideoParamsRange(arg.bandwidth, undefined, undefined, undefined, true);
                     } else if (arg.message === 'PublisherBandwidth') {
                         localVideoStreamATStateBw = arg.bandwidth;
                         stream.setVideoParamsRange(arg.bandwidth, undefined, undefined, undefined, true);
                     }
                 }
             });
         }
     };
 
 
     const socketOnBandwidthEvents = (arg) => {
         if (arg.id === 'bw-alert') {
             socketOnBandwidthAlert(arg.msg);
         } else if (arg.id === 'publisher-bw' || arg.id === 'share-bw') {
             socketOnSelfBandwidthAlert(arg.msg);
         } else {
             const evt = RoomEvent({ type: arg.id, message: arg.msg });
             that.dispatchEvent(evt);
         }
     }
 
     const socketOnBandwidthAlert = (arg) => {
         Logger.info('OnbandwidthAlert:', arg);
         for (let i = 0; i < arg.length; i++) {
             const stream = that.remoteStreams.getAll()[arg[i].streamId];
             if (stream == null) {
                 Logger.info('Stream not found');
                 continue;
             }
             stream.setBandwidthAlert(arg[i]);
         }
     };
 
     // We receive an event of new data in one of the streams
     const socketOnDataStream = (arg) => {
         if (!that.activeTalker) {
             const stream = remoteStreams.get(arg.id);
             const evt = StreamEvent({ type: 'stream-data-in', msg: arg.msg, stream });
             stream.dispatchEvent(evt);
         } else if ((that.eventsList && that.eventsList !== undefined) && ('message-received' in that.eventsList)) {
             const evt = RoomEvent({ type: 'message-received', message: arg.msg });
             that.dispatchEvent(evt);
         } else {
             const evt = RoomEvent({ type: 'active-talker-data-in', message: arg.msg });
             that.dispatchEvent(evt);
         }
     };
 
     // method to inject file share UI in any given element
     // to do set position , style , UI configurable
     const inFileShareUI = (dat, elToAppend, command, style) => {
         const fsInfoContainer = document.createElement('div');
         fsInfoContainer.setAttribute('id', `fs-notif-id-${Math.random()}`);
         fsInfoContainer.setAttribute('class', 'fs-notification');
         fsInfoContainer.setAttribute('style', 'display:block;position:relative;z-index:3;padding:5px 10px;top:50%;right:50%;transform:translateX(50%);background:rgba(0,0,0,0.29);border-radius:5px;color:rgb(255,255,255)');
         elToAppend.appendChild(fsInfoContainer);
         elToAppend = fsInfoContainer;
         let minfo;
         let fileInfo;
         let br;
         let text;
 
         switch (command) {
             case 'fs-upload-init':
                 minfo = `upload started for file ${dat.data[dat.data.length - 1].name} of size ${dat.data[dat.data.length - 1].size / 1000} KB`;
                 fileInfo = dat.message;
                 br = document.createElement('br');
                 elToAppend.appendChild(br);
                 text = document.createTextNode(minfo);
                 elToAppend.appendChild(text);
                 elToAppend.appendChild(br);
                 break;
 
             case 'fs-file-uploaded':
                 minfo = `uploaded 100 % ${dat.name}  of size ${dat.size / 1000} KB`;
                 fileInfo = dat.message;
                 br = document.createElement('br');
                 elToAppend.appendChild(br);
                 text = document.createTextNode(minfo);
                 elToAppend.appendChild(text);
                 elToAppend.appendChild(br);
                 break;
 
             case 'fs-upload-started':
                 minfo = `${dat.sender} is sharing file ${dat.message.data[(dat.message.data.length - 1)].name}  of size ${dat.message.data[(dat.message.data.length - 1)].size / 1000} KB`;
                 fileInfo = dat.message;
                 br = document.createElement('br');
                 elToAppend.appendChild(br);
                 text = document.createTextNode(minfo);
                 elToAppend.appendChild(text);
                 elToAppend.appendChild(br);
                 break;
 
             case 'fs-file-available':
                 fileInfo = dat.message;
                 br = document.createElement('br');
                 elToAppend.appendChild(br);
                 const btn = document.createElement('BUTTON');
                 const t = document.createTextNode(fileInfo.name);
                 btn.setAttribute('style', 'color:red;font-size:23px');
                 btn.setAttribute('id', shFileList.length - 1);
                 btn.appendChild(t);
                 elToAppend.appendChild(btn);
                 btn.onclick = function () {
                     //    that.recvFileWithUrl(btn.id);
                     that.recvFiles(btn.id);
                 };
                 elToAppend.appendChild(br);
                 break;
 
             default:
                 Logger.info('random data to fantom UI ');
         }
     };
 
     /**
  * socketOnDataStreamToRoom method bind to socket
  */
     const socketOnDataStreamToRoom = (dat, callback) => {
         let msgType;
         Logger.info('socketOnDataStreamToRoom', dat.type);
         switch (dat.type) {
             case 'chat':
                 msgType = 'message-received';
                 break;
 
             case 'data-internal-in':
                 msgType = dat.message.type;
                 processInternalDataIn(dat, callback);
                 break;
 
             default:
                 msgType = 'user-data-received';
         }
 
         if (that.eventsList && (msgType in that.eventsList)) {
             const evt = RoomEvent({ type: msgType, message: dat });
             that.dispatchEvent(evt);
             if (callback) {
                 callback(customErrors.error_000);
             }
         } else if (callback) {
             callback(customErrors.error_1169);
         }
     };
 
     const processInternalDataIn = (dat, callback) => {
         //  Logger.info('intenral  data received', dat);
         switch (dat.message.type) {
             case 'fs-upload-started': /// file is being shared with you
                 dat.message.broadcast = dat.broadcast;
                 dat.message.sender = dat.sender;
                 dat.message.senderId = dat.senderId;
                 Logger.info(' file is being shared with you fs-upload-started', dat.message);
                 if (that.showFsUi === true && document.getElementById(fileShareUI.recvElToAppend) !== null) {
                     inFileShareUI(dat, document.getElementById(fileShareUI.recvElToAppend), 'fs-upload-started');
                     EL.info('room-event', customEvents.event_file_download_success, { error: {} });
                 }
                 break;
 
             case 'fs-file-available':
                 // file is available  to dowmload
                 dat.message.broadcast = dat.broadcast;
                 dat.message.sender = dat.sender;
                 dat.message.senderId = dat.senderId;
                 shFileList.push(dat.message);
 
                 const favailable = {
                     broadcast: dat.broadcast,
                     sender: dat.sender,
                     senderId: dat.senderId,
                     name: dat.message.name,
                     size: dat.message.size,
                     speed: dat.message.speed,
                     createdAt: dat.message.createdAt,
                     dlimit: dat.message.dlimit,
                     time: dat.message.time,
                     expiresAt: dat.message.expiresAt,
                     timeLimit: dat.message.timeLimit,
                     index: shFileList.length - 1,
                 };
 
                 that.availableFiles.push(favailable);
                 Logger.info('file is available to download fs-file-available', favailable);
                 const fDownloadResult = {
                     messageType: 'download-available',
                     result: 0,
                     description: 'file-available',
                     response: {
                         downloadStatus: 'available',
                         jobId: favailable.index,
                         downloadInfo: favailable,
                     },
                 };
                 const evt = RoomEvent({ type: 'fs-download-result', message: fDownloadResult });
                 that.dispatchEvent(evt);
 
                 if (that.showFsUi === true && document.getElementById(fileShareUI.recvElToAppend) !== null) {
                     inFileShareUI(dat, document.getElementById(fileShareUI.recvElToAppend), 'fs-file-available');
                 }
                 break;
 
             case 'fs-upload-cancelled':
                 break;
 
             default:
                 Logger.info('unknown internal data type from signaling server ', dat.type);
                 EL.error('room-event', customEvents.event_file_download_failed, { error: {} });
                 break;
         }
     };
 
     // We receive an event of new data in one of the streams
     const socketOnUpdateAttributeStream = (arg) => {
         const stream = remoteStreams.get(arg.id);
         const evt = StreamEvent({
             type: 'stream-attributes-updated',
             attrs: arg.attrs,
             stream,
         });
         stream.updateLocalAttributes(arg.attrs);
         stream.dispatchEvent(evt);
     };
 
     // We receive an event of a stream removed from the room
     const socketOnRemoveStream = (arg) => {
         let stream = localStreams.get(arg.id);
         if (stream) {
             onStreamFailed(stream);
             return;
         }
 
         stream = remoteStreams.get(arg.id);
         if (stream) {
             remoteStreams.remove(arg.id);
             removeStream(stream);
             const evt = StreamEvent({ type: 'stream-removed', stream });
             EL.info('room-event', customEvents.event_general_success, { message: ('socketOnRemoveStream - stream removed') });
             that.dispatchEvent(evt);
         }
     };
 
     // The socket has disconnected
     const socketOnDisconnect = () => {
         Logger.info('Socket disconnected, lost connection to ClientController, ');
         if (that.state !== DISCONNECTED) {
             that.breakOutRoom.disconnectAll();
             clearAll();
             /*if (that.reconnectionAllowed === false ||  that.reconnectAttempt >= MAXRECONNECTIONATTEMPT) {
               Logger.error('Unexpected disconnection from Client Controller');
               const disconnectEvt = RoomEvent({ type: 'room-disconnected', message: 'unexpected-disconnection' });
               that.dispatchEvent(disconnectEvt);
             }else {
               Logger.error("socketOnDisconnect() : reconnection allowed retries: " + that.reconnectAttempt);
               clearAll();
             }*/
         }
         // do not send network failed
         //    let networkFailed = RoomEvent({ type: 'network-failed', error: customErrors.error_1161.result,  message: customErrors.error_1161.error });
         //   that.dispatchEvent(networkFailed);
     };
 
     const socketOnICEConnectionFailed = (arg) => {
         let stream;
         if (!arg.streamId) {
             return;
         }
         const message = `ICE Connection Failed on ${arg.type} ${arg.streamId} ${that.state}`;
         Logger.error(message);
         EL.error('room-event', customEvents.event_ice_failed, { arg });
 
         if (arg.type === 'publish') {
             stream = localStreams.get(arg.streamId);
         } else {
             stream = remoteStreams.get(arg.streamId);
         }
         onStreamFailed(stream, message);
     };
 
     const socketOnError = (e) => {
         Logger.error('Cannot connect to client Controller');
         const connectEvt = RoomEvent({ type: 'room-error', message: e });
         EL.info('room-event', customEvents.event_general_success, { message: ('socketOnError - Cannot connect to client Controller') });
         that.dispatchEvent(connectEvt);
     };
 
     const sendDataSocketFromStreamEvent = (evt) => {
         Logger.debug('sendDataSocketFromStreamEvent');
         const stream = evt.stream;
         const msg = evt.msg;
         if (stream.local) {
             socket.sendMessage('sendDataStream', { id: stream.getID(), msg });
         } else {
             Logger.error('You can not send data through a remote stream');
             EL.error('room-event', customEvents.event_general_failed, { message: ('sendDataSocketFromStreamEvent - You can not send data through a remote stream') });
         }
     };
 
     const validateSendUserData = (msg, broadcast, clients, type, callback) => {
         if (!msg || (broadcast === undefined) || (typeof broadcast !== 'boolean') || ((broadcast === false) && (!clients || (!Array.isArray(clients)) || !clients.length))) {
             Logger.error('message: invalid parameter, msg/broadcast/clients undefined or type mistmatch');
             if (callback) {
                 callback(customErrors.error_1155);
             }
             return;
         }
         var msg_size_kbs = JSON.stringify(msg).length / 1024;
         if(msg_size_kbs > config.senduserDataMaximumLimit) {
             Logger.error('message: large data, failed to handle larger text-data. Max allowed length is ' + config.senduserDataMaximumLimit + ' KB');
             if (callback) {
                 callback(customErrors.error_1195);
             }
             return;
         }
         const tempMsg = {};
         tempMsg.msg = msg;
         tempMsg.broadcast = broadcast;
         tempMsg.clients = clients;
         tempMsg.type = type;
         that.socket.emitEvent('sendDataStreamToRoom', tempMsg, callback);
     };
 
     /* send user data */
     that.sendUserData = (msg, broadcast, clientList, callback) => {
         validateSendUserData(msg, broadcast, clientList, 'user_data', callback);
     };
 
     // manu dummy FT testing
     /* send user data */
     that.sendFtData = (msg, type, broadcast, clientList, callback) => {
         msg.type = type;
         validateSendUserData(msg, broadcast, clientList, 'data-internal-in', callback);
     };
     // end
 
     /**
      * Send message to room object
      */
     that.sendMessage = (msg, broadcast, clientList, callback) => {
         validateSendUserData(msg, broadcast, clientList, 'chat', callback);
     };
 
     const validateLayoutData = (layoutOptions, callback = ()=>{}) => {
         var layouts = ['grid', 'talker', 'presenter'];
         var services = ['liveRecording', 'streaming', 'screenShare','all'];
         var service = layoutOptions.service;
         var layout = layoutOptions.layout;
         if(callback == undefined || typeof callback !== 'function') {
             Logger.error('message: invalid value for callback parameter');
             return;
         }
         if (that.me.role !== 'moderator') {
             Logger.warning('User should be a moderator to change layout details.');
             callback(customErrors.error_1168);
             return;
         }
         
         if (that.state === DISCONNECTED) {
             Logger.info('Room is disconnected');
             callback(customErrors.error_7079);
             return;
         }
         if(layout == undefined || typeof layout !== 'string'  || !layouts.includes(layout)) {
             Logger.error('message: invalid value for layout parameter');
             if (callback) {
                 callback(customErrors.error_1192);
             }
             return;
         }
         if(service == undefined || typeof service !== 'string'  || !services.includes(service)) {
             Logger.error('message: invalid value for service parameter');
             if (callback) {
                 callback(customErrors.error_1193);
             }
             return;
         }
         var layoutData = {};
         layoutData.layout = layout;
         layoutData.service = service;       
 
         that.socket.sendParamEvent('sendLayoutData', layoutData, (result, error) => {
             Logger.info('sending sendLayoutData');
             if (result === null) {
                 Logger.error('Error in layout update: ', error);
                 callback(error);
                 return;
             }
             else {
                 Logger.info('Layout updated successfully.');
                 callback(result);
             }
         });
     };
 
     const displayVideoStats = (videoStats) => {
         const value = 0;
         let resHeight = 0;
         let resWidth = 0;
         let bw = 0;
         let bps = 0;
         let fps = 0;
         let loss = 0;
         let keyPair = '';
 
         if (videoStats) {
             Object.keys(videoStats).forEach((key) => {
                 switch (key) {
                     case 'bitrateCalculated':
                         bps = Math.round((videoStats[key]) / 1000);
                         break;
 
                     case 'framerateCalculated':
                         fps = videoStats[key];
                         break;
 
                     case 'bandwidth':
                         bw = Math.round((videoStats[key]) / 1000);
                         break;
 
                     case 'packetsLost':
                         loss = videoStats[key];
                         break;
 
                     case 'frameHeight':
                         resHeight = videoStats[key];
                         break;
 
                     case 'frameWidth':
                         resWidth = videoStats[key];
                         break;
 
                     default:
                         break;
                 }
             });
             if(!config.csp_enabled) {
                 keyPair += `<div> <strong style="color:black;" > ${resWidth}X${resHeight}p${fps}@${bps}Kbps</strong>:</div>`;
                 if (bw || loss) {
                     keyPair += `<div> <strong style="color:black;" > AvailBw:${bw}Kbps, loss:${loss}</strong>:</div>`;
                 }
             }
         }
         if(!config.csp_enabled) {
             return {
                 displayString: keyPair,
                 resHeight,
                 resWidth,
                 packetsLost: loss,
                 bandwidth: bw,
                 frameRate: fps,
                 bitrate: bps,
             };
         } else {
             return {
                 resHeight,
                 resWidth,
                 packetsLost: loss,
                 bandwidth: bw,
                 frameRate: fps,
                 bitrate: bps,
             };
         }
     };
 
     const socketOnStatSubscription = (arg) => {
         const statNodes = arg.statData.stats;
         const statInfo = {};
         const talkerStats = [];
         const selfPublisherStat = {};
         const canvasStat = {};
         const shareStat = {};
 
         statNodes.forEach((statNode) => {
             const streamType = statNode.streamType;
             // To DO : needs refactoring .. will do during QA
             if (streamType === 'actStat') {
                 const publisherStat = {};
                 if(!config.csp_enabled) {
                     var selecterStrings = document.querySelectorAll(`#stats-left-part-${statNode.subscriberStreamId}`);
                     if (talkerStats[statNode.subscriberStreamId] == undefined) {
                         talkerStats[statNode.subscriberStreamId] = { id: statNode.subscriberStreamId };
                     }
                     publisherStat.video = [];
                     selecterStrings.forEach((selecterString) => {
                         if ((selecterString !== undefined) && (selecterString !== null)) {
                             let keyPair = '';
                             //keyPair += `<div>Publisher bitrate</div>`;
                             Object.keys(statNode.total).forEach((key) => {
                                 if (key === 'bitrateCalculated') {
                                     const value = Math.round((statNode.total[key]) / 1000);
                                     if (that.mediaStatsMode == 'notify' || that.mediaStatsMode == 'notify-display') {
                                         publisherStat['total-bitrate-kbps'] = value;
                                     } else if (that.mediaStatsMode == 'display' || that.mediaStatsMode == 'notify-display') {
                                         keyPair += `<div> <strong>Tx Total:</strong>:  ${value}Kbps </div>`;
                                     }
                                 }
                             });
                             for (let index = 0; index < statNode.videoStats.length; index++) {
                                 publisherStat.video[index] = displayVideoStats(statNode.videoStats[index]);
                                 if (that.mediaStatsMode == 'display' || that.mediaStatsMode == 'notify-display') {
                                     keyPair += publisherStat.video[index].displayString;
                                     const totalDetails =
                                         `<div id="" class="stats-detail"> 
                                     ${keyPair}
                                 </div>`;
                                     selecterString.innerHTML = totalDetails;
                                 }
                             }
                         }
                     });
                 } else {
                     if (talkerStats[statNode.subscriberStreamId] == undefined) {
                         talkerStats[statNode.subscriberStreamId] = { id: statNode.subscriberStreamId };
                     }
                     publisherStat.video = [];
                         Object.keys(statNode.total).forEach((key) => {
                             if (key === 'bitrateCalculated') {
                                 const value = Math.round((statNode.total[key]) / 1000);
                                 if (that.mediaStatsMode == 'notify' || that.mediaStatsMode == 'notify-display') {
                                     publisherStat['total-bitrate-kbps'] = value;
                                 }
                             }
                         });
                         for (let index = 0; index < statNode.videoStats.length; index++) {
                             publisherStat.video[index] = displayVideoStats(statNode.videoStats[index]);
                         }
                 }
                 talkerStats[statNode.subscriberStreamId].publisher = publisherStat;
             } else if (streamType === 'selfPcStat') {
                 if (talkerStats[statNode.subscriberStreamId] == undefined) {
                     talkerStats[statNode.subscriberStreamId] = {
                         id: statNode.subscriberStreamId,
                     };
                 }
                 const subscriberStat = {};
                 subscriberStat.video = [];
                 if(!config.csp_enabled) {
                     const streamId = parseInt(statNode.streamId) + 1;
                     const dataOnRightParts = document.querySelectorAll(`#stats-right-part-${statNode.subscriberStreamId}`);
                     dataOnRightParts.forEach((dataOnRightPart) => {
                         if ((dataOnRightPart !== undefined) && (dataOnRightPart !== null)) {
                             let keyPair = '';
                             //keyPair += `<div> <strong>Subscriber stream ID</strong>:  ${streamId} </div>`;
                             Object.keys(statNode.total).forEach((key) => {
                                 if (key === 'bitrateCalculated') {
                                     const value = Math.round((statNode.total[key]) / 1000);
                                     if (that.mediaStatsMode == 'notify' || that.mediaStatsMode == 'notify-display') {
                                         subscriberStat['total-bitrate-kbps'] = value;
                                     } else if (that.mediaStatsMode == 'display' || that.mediaStatsMode == 'notify-display') {
                                         keyPair += `<div> <strong>Rx ID: ${streamId}, Total:</strong>:  ${value}Kbps </div>`; //   keyPair += `<div> <strong>${key}</strong>:  ${value}kbps </div>`;
                                     }
                                 }
                             });
                             const totalDetails =
                                 `<div id="" class="stats-detail"> 
                                         ${keyPair}
                                     </div>`;
                             dataOnRightPart.innerHTML = totalDetails;
                             //keyPair += `<div> Peer connection Video stream stats </div>`;
                             for (let index = 0; index < statNode.videoStats.length; index++) {
                                 subscriberStat.video[index] = displayVideoStats(statNode.videoStats[index]);
                                 if (that.mediaStatsMode == 'display' || that.mediaStatsMode == 'notify-display') {
                                     keyPair += subscriberStat.video[index].displayString;
                                     const videoDetails =
                                         `<div id="" class="stats-detail"> 
                                 ${keyPair}
                                 </div>`;
                                     dataOnRightPart.innerHTML = videoDetails;
                                 }
                             }
                         }
                     });
                 } else {
                     const streamId = parseInt(statNode.streamId) + 1;
                             Object.keys(statNode.total).forEach((key) => {
                                 if (key === 'bitrateCalculated') {
                                     const value = Math.round((statNode.total[key]) / 1000);
                                     if (that.mediaStatsMode == 'notify' || that.mediaStatsMode == 'notify-display') {
                                         subscriberStat['total-bitrate-kbps'] = value;
                                     }
                                 }
                             });
                             for (let index = 0; index < statNode.videoStats.length; index++) {
                                 subscriberStat.video[index] = displayVideoStats(statNode.videoStats[index]);
                             }
                 }
                 Logger.debug(` subscriberStreamId: ${statNode.subscriberStreamId} substat: ${JSON.stringify(subscriberStat)}`);
                 talkerStats[statNode.subscriberStreamId].subscriber = subscriberStat;
             } else if (streamType === 'selfPubStat') {
                 if(!config.csp_enabled) {
                     var selecterStrings = document.querySelectorAll(`#stats-left-part-${statNode.streamId}`);
                     selecterStrings.forEach((selecterString) => {
                         if ((selecterString !== undefined) && (selecterString !== null)) {
                             let keyPair = '';
                             //keyPair += `<div> Self upload bitrate </div>`;
                             Object.keys(statNode.total).forEach((key) => {
                                 if (key === 'bitrateCalculated') {
                                     const value = Math.round((statNode.total[key]) / 1000);
                                     if (that.mediaStatsMode == 'notify' || that.mediaStatsMode == 'notify-display') {
                                         selfPublisherStat['total-bitrate-kbps'] = value;
                                     } else if (that.mediaStatsMode == 'display' || that.mediaStatsMode == 'notify-display') {
                                         keyPair += `<div> <strong>Tx Total</strong>: ${value}Kbps</div>`;
                                     }
                                 }
                             });
                             selfPublisherStat.video = [];
                             for (let index = 0; index < statNode.videoStats.length; index++) {
                                 selfPublisherStat.video[index] = displayVideoStats(statNode.videoStats[index]);
                                 if (that.mediaStatsMode == 'display' || that.mediaStatsMode == 'notify-display') {
                                     keyPair += selfPublisherStat.video[index].displayString;
                                     const totalDetails =
                                         `<div id="" class="stats-detail"> 
                                         ${keyPair}
                                     </div>`;
                                     selecterString.innerHTML = totalDetails;
                                 }
                             }
                         }
                     });
                 } else {
                         Object.keys(statNode.total).forEach((key) => {
                             if (key === 'bitrateCalculated') {
                                 const value = Math.round((statNode.total[key]) / 1000);
                                 if (that.mediaStatsMode == 'notify' || that.mediaStatsMode == 'notify-display') {
                                     selfPublisherStat['total-bitrate-kbps'] = value;
                                 }
                             }
                         });
                         selfPublisherStat.video = [];
                         for (let index = 0; index < statNode.videoStats.length; index++) {
                             selfPublisherStat.video[index] = displayVideoStats(statNode.videoStats[index]);
                         }
                 }
             } else if (streamType === 'canvasStat') {
                 if(!config.csp_enabled) {
                     //    Logger.info('Canvas stream', parseInt(statNode.streamId) + 1, 'total', statNode.total, 'statNode', statNode);
                     var selecterStrings = document.querySelectorAll(`#stats-left-part-${statNode.subscriberStreamId}`);
                     selecterStrings.forEach((selecterString) => {
                         if ((selecterString !== undefined) && (selecterString !== null)) {
                             let keyPair = '';
                             //keyPair += `<div>Canvas publisher bitrate</div>`;
                             Object.keys(statNode.total).forEach((key) => {
                                 if (key === 'bitrateCalculated') {
                                     const value = Math.round((statNode.total[key]) / 1000);
                                     if (that.mediaStatsMode == 'notify' || that.mediaStatsMode == 'notify-display') {
                                         canvasStat['total-bitrate-kbps'] = value;
                                     } else if (that.mediaStatsMode == 'display' || that.mediaStatsMode == 'notify-display') {
                                         keyPair += `<div> <strong>Tx Total:</strong>:  ${value}Kbps </div>`;
                                     }
                                 }
                             });
                             canvasStat.video = displayVideoStats(statNode.videoStats);
                             if (that.mediaStatsMode == 'display' || that.mediaStatsMode == 'notify-display') {
                                 keyPair += canvasStat.video.displayString;
                                 const totalDetails =
                                     `<div id="" class="stats-detail"> 
                                             ${keyPair}
                                         </div>`;
                                 selecterString.innerHTML = totalDetails;
                             }
                         }
                     });
                 } else {
                     Object.keys(statNode.total).forEach((key) => {
                         if (key === 'bitrateCalculated') {
                             const value = Math.round((statNode.total[key]) / 1000);
                             if (that.mediaStatsMode == 'notify' || that.mediaStatsMode == 'notify-display') {
                                 canvasStat['total-bitrate-kbps'] = value;
                             }
                         }
                     });
                     canvasStat.video = displayVideoStats(statNode.videoStats);
                 }
             } else if (streamType === 'shareStat') {
                 if(!config.csp_enabled) {
                     //   Logger.info('shareStat stream', parseInt(statNode.streamId) + 1, 'total', statNode.total);
                     var selecterStrings = document.querySelectorAll(`#stats-left-part-${statNode.subscriberStreamId}`);
                     selecterStrings.forEach((selecterString) => {
                         if ((selecterString !== undefined) && (selecterString !== null)) {
                             let keyPair = '';
                             //keyPair += `<div>Share Publisher bitrate</div>`;
                             Object.keys(statNode.total).forEach((key) => {
                                 if (key === 'bitrateCalculated') {
                                     const value = Math.round((statNode.total[key]) / 1000);
                                     if (that.mediaStatsMode == 'notify' || that.mediaStatsMode == 'notify-display') {
                                         shareStat['total-bitrate-kbps'] = value;
                                     } else if (that.mediaStatsMode == 'display' || that.mediaStatsMode == 'notify-display') {
                                         keyPair += `<div> <strong>Tx Total:</strong>:  ${value}Kbps </div>`;
                                     }
                                 }
                             });
                             shareStat.video = displayVideoStats(statNode.videoStats);
                             if (that.mediaStatsMode == 'display' || that.mediaStatsMode == 'notify-display') {
                                 keyPair += shareStat.video.displayString;
                                 const totalDetails =
                                     `<div id="" class="stats-detail"> 
                                             ${keyPair}
                                         </div>`;
                                 selecterString.innerHTML = totalDetails;
                             }
                         }
                     });
                 } else {
                     Object.keys(statNode.total).forEach((key) => {
                         if (key === 'bitrateCalculated') {
                             const value = Math.round((statNode.total[key]) / 1000);
                             if (that.mediaStatsMode == 'notify' || that.mediaStatsMode == 'notify-display') {
                                 shareStat['total-bitrate-kbps'] = value;
                             }
                         }
                     });
                     shareStat.video = displayVideoStats(statNode.videoStats);
                 }
             }
         });
         Logger.info(`that.mediaStatsMode : ${that.mediaStatsMode} talkers: ${JSON.stringify(talkerStats)} selfPublisherStat: ${JSON.stringify(selfPublisherStat)}`);
         if (that.mediaStatsMode == 'notify' || that.mediaStatsMode == 'notify-display') {
             that.dispatchEvent({
                 type: 'media-stats',
                 talkers: talkerStats,
                 publisher: selfPublisherStat,
                 share: shareStat,
                 canvas: canvasStat,
             });
         }
     };
 
     const updateAttributesFromStreamEvent = (evt) => {
         const stream = evt.stream;
         const attrs = evt.attrs;
         if (stream.local) {
             stream.updateLocalAttributes(attrs);
             socket.sendMessage('updateStreamAttributes', { id: stream.getID(), attrs });
             EL.info('room-event', customEvents.event_general_success, { message: ('updateAttributesFromStreamEvent - updateStreamAttributes - success') });
         } else {
             Logger.error('You can not update attributes in a remote stream');
         }
     };
 
     const socketEventToArgs = (func, event) => {
         if (event.args) {
             func(...event.args);
         } else {
             func();
         }
     };
 
     const createSdpConstraints = (type, stream, options) => ({
         state: type,
         data: stream.ifData(),
         audio: stream.ifAudio(),
         video: stream.ifVideo(),
         screen: stream.ifScreen(),
         canvas: stream.ifCanvas(),
         canvasType: options.canvasType, // applicable only incase of canvas else its undefined
         attributes: stream.getAttributes(),
         metadata: options.metadata,
         createOffer: options.createOffer,
         muteStream: options.muteStream,
         shareMetadata: options.shareMetadata,
     });
 
     const populateStreamFunctions = (id, streamInput, error, callback = () => { }) => {
         const stream = streamInput;
 
         if (id === null) {
             Logger.error('Error when publishing the stream', error);
             EL.error('room-event', customEvents.event_stream_publish_failed, { error });
             // Unauth -1052488119
             // Network -5
             callback(undefined, error);
             return;
         }
         Logger.info('Stream published');
         EL.info('room-event', customEvents.event_stream_publish_success, { error: {} });
         //stream.getID = () => id;
         stream.setID (id);
         stream.on('internal-send-data', sendDataSocketFromStreamEvent);
         stream.on('internal-set-attributes', updateAttributesFromStreamEvent);
         localStreams.add(id, stream);
         stream.room = that;
         callback(id);
 
         const onResult = (result) => {
             if (result) {
                 //         clearInterval(peerStatsInterval);
                 const additionalOptions = {
                     streamId: stream.getID(),
                     selectedCandidates: result.selectedCandidates,
                     negotiatedCodecs: {
                         video: {
                             codec: (that.mediaConfiguration === 'default' || that.mediaConfiguration === 'Default') ? 'VP8' : that.mediaConfiguration,
                         },
                         audio: {
                             codec: 'OPUS',
                         },
                     },
                     selectedCam: stream.video.deviceId,
                     selectedMic: stream.audio.deviceId,
                     externalIp: that.externalIp,
                 };
                 that.createEventLog('clientStreamPublishSuccess', additionalOptions);
             }
         };
 
         /*   if(stream.pc) {
                peerStatsInterval = setInterval(() => {
                    getPeerStats(stream.pc.peerConnection, onResult);
                }, 1000);
            }*/
     };
 
     const publishExternal = (streamInput, options, callback = () => { }) => {
         const stream = streamInput;
         let type;
         let arg;
         if (stream.url) {
             type = 'url';
             arg = stream.url;
         } else {
             type = 'recording';
             arg = stream.recording;
         }
         Logger.info('Checking publish options for', stream.getID());
         stream.checkOptions(options);
         socket.sendSDP('publish', createSdpConstraints(type, stream, options), arg, (id, error) => {
             populateStreamFunctions(id, stream, error, callback);
         });
     };
 
     const publishData = (streamInput, options, callback = () => { }) => {
         const stream = streamInput;
         socket.sendSDP('publish', createSdpConstraints('data', stream, options), undefined, (id, error) => {
             populateStreamFunctions(id, stream, error, callback);
         });
     };
 
     const publishVcxRtc = (streamInput, options, callback = () => { }) => {
         const stream = streamInput;
         if (((stream.screen === undefined) || (stream.screen == false)) && 
             ((stream.canvas === undefined) || (stream.canvas == false))) {
             const maxVideoLayers = options.maxVideoLayers ? options.maxVideoLayers : that.maxVideoLayers;
             if ((maxVideoLayers > 1) && (maxVideoLayers <= 3)) {
                 options.simulcast = {
                     numSpatialLayers: maxVideoLayers,
                     spatialLayerBitrates: config.video_layer_bitrates,
                 };
             }
             Logger.info('Publishing Main, createOffer', options.createOffer, ` Max video layers: ${maxVideoLayers}`);
         } else if ((stream.canvas !== undefined) && (stream.canvas == true)) {
             Logger.info('Publishing Canvas spatiallayers 3 createOffer', options.createOffer);
             //options.simulcast = { numSpatialLayers: 3 };
         } else {
             Logger.info('Publishing Share createOffer', options.createOffer);
         }
         const constraints = createSdpConstraints('media_engine', stream, options);
         constraints.minVideoBW = options.minVideoBW;
         constraints.maxVideoBW = options.maxVideoBW;
         constraints.scheme = options.scheme;
 
         Logger.info('publishVcxRtc constraints: ', constraints);
         socket.sendSDP('publish', constraints, undefined, (response) => {
             if (response && response.result === 0) {
                 populateStreamFunctions(response.id, stream, undefined, undefined);
                 createLocalStreamVcxRtcConnection(stream, options);
                 stream.clientId = that.clientId;
                 stream.maxVideoBwKbpsReqByServer = options.maxVideoBW;
             }
             callback(response);
         });
         if (mediaConnectionTimer != undefined ) clearTimeout(mediaConnectionTimer);
           mediaConnectionTimer = setTimeout(mediaConnectionTimeout, 30000);
     };
 
     const getVideoConstraints = (stream, video) => {
         const ifVideo = video && stream.ifVideo();
         const width = video && video.width;
         const height = video && video.height;
         const frameRate = video && video.frameRate;
         if (width || height || frameRate) {
             return {
                 width,
                 height,
                 frameRate,
             };
         }
         return ifVideo;
     };
 
     const subscribeVcxRtc = (streamInput, optionsInput, callback = () => { }) => {
         const stream = streamInput;
         const options = optionsInput;
         options.maxVideoBW = options.maxVideoBW || spec.defaultVideoBW;
         if (options.maxVideoBW > spec.maxVideoBW) {
             options.maxVideoBW = spec.maxVideoBW;
         }
         options.audio = (options.audio === undefined) ? true : options.audio;
         options.video = (options.video === undefined) ? true : options.video;
         options.data = (options.data === undefined) ? true : options.data;
         options.canvas = (options.canvas === undefined) ? true : options.canvas;
         stream.checkOptions(options);
         const constraint = {
             streamId: stream.getID(),
             audio: options.audio && stream.ifAudio(),
             video: getVideoConstraints(stream, options.video),
             data: options.data && stream.ifData(),
             canvas: options.canvas && stream.ifCanvas(),
             browser: that.Connection.browserEngineCheck(),
             createOffer: options.createOffer,
             metadata: options.metadata,
             muteStream: options.muteStream,
             slideShowMode: options.slideShowMode,
         };
 
         Logger.info(`SOCKET EVENT subscribe:- ${JSON.stringify(constraint)}`);
 
         socket.sendSDP('subscribe', constraint, undefined, (result, error) => {
             if (result === null) {
                 Logger.error('Error subscribing to stream ', error);
                 EL.error('room-event', customEvents.event_stream_subscribe_failed, { error });
                 callback(undefined, error);
                 return;
             }
             Logger.info('Subscriber added');
             Logger.info('stream subscription result', result);
             // EL.info('room-event', customEvents.event_stream_subscribe_success, { error: {} });
             createRemoteStreamVcxRtcConnection(stream, options);
 
             callback(true);
         });
     };
 
     const subscribeData = (streamInput, options, callback = () => { }) => {
         const stream = streamInput;
         socket.sendSDP(
             'subscribe',
             {
                 streamId: stream.getID(),
                 data: options.data,
                 metadata: options.metadata,
             },
             undefined,
             (result, error) => {
                 if (result === null) {
                     Logger.error('Error subscribing to stream ', error);
                     EL.error('room-event', customEvents.event_stream_subscribe_failed, { error });
                     callback(undefined, error);
                     return;
                 }
                 Logger.info('Stream subscribed');
                 const evt = StreamEvent({ type: 'stream-subscribed', stream });
                 that.dispatchEvent(evt);
                 callback(true);
             },
         );
     };
 
     // detect internet connection
     const doesConnectionExist = () => {
         Logger.info('detect doesConnectionExist');
         if (that.state === DISCONNECTED) {
             let onlyOnce = 0;
             const xhr = new XMLHttpRequest();
             //let file = "https://api.enablex.io/"; // need to remove hardcoding , shall be passed from options ?
             const file = (that.internetDetectionUrl !== undefined) ? that.internetDetectionUrl : config.internetDetectionUrl;
             xhr.timeout = 15000; // time in milliseconds
             const randomNum = Math.round(Math.random() * 10000);
 
             xhr.open('HEAD', `${file}?rand=${randomNum}`, true);
             xhr.ontimeout = (e) => {
                 // XMLHttpRequest timed out. Do something here.
                 Logger.info('xhr timeout---------------');
             };
 
             xhr.addEventListener('readystatechange', processRequest, false);
 
             function processRequest(e) {
                 if (xhr.readyState === 4) {
                     if (xhr.status >= 200 && xhr.status < 304) {
                         onlyOnce++;
                         Logger.info('internet is back connection exists !');
                         stopInternetDetection();
                         if (onlyOnce === 1) {
                             Logger.info('----------reconnect-rejoin room-----------');
                             if (that.reconnectAttempt < MAXRECONNECTIONATTEMPT) {
                                 that.reJoinRoom();
                             } else {
                                 Logger.info(' reconnect attempts exceed then max allowed limit');
                                 that.reconnectionAllowed = false;
                                 stopInternetDetection();
                                 clearAll();
                                 // send reconnection timeout event to application
                                 const reconnectionTimedOut = RoomEvent({ type: 'network-reconnect-timeout', error: customErrors.error_1165.result, message: customErrors.error_1165.error });
                                 that.dispatchEvent(reconnectionTimedOut);
 
                                 EL.error('room-event', customEvents.event_network_reconnect_timeout, { type: 'network-reconnect-timeout', error: customErrors.error_1165.result, message: customErrors.error_1165.error });
                             }
                         }
                     } else {
                         Logger.info("internet connection doesn't exist!");
                         if (that.reconnectAttempt >= MAXRECONNECTIONATTEMPT) { // put a condition to check the reconnection timer also
                             Logger.info("connection doesn't exist and reconnect attempt exceeded");
                             that.reconnectionAllowed = false;
                             stopInternetDetection();
                             clearAll();
                             // send reconnection timeout event to application
                             const reconnectionTimedOut = RoomEvent({ type: 'network-reconnect-timeout', error: customErrors.error_1165.result, message: customErrors.error_1165.error });
                             that.dispatchEvent(reconnectionTimedOut);
                         }
                         const curTime = Date.now();
                         if ((curTime - that.reconStartTime) > that.reconnectionTimeOutInterval) {
                             Logger.info('Internet did not resumed within timeout limits of ', that.reconnectionTimeOutInterval / 1000, 'seconds');
                             that.reconnectionAllowed = false;
                             stopInternetDetection();
                             clearAll();
                             const reconnectionTimedOut = RoomEvent({ type: 'network-reconnect-timeout', error: customErrors.error_1166.result, message: customErrors.error_1166.error });
                             that.dispatchEvent(reconnectionTimedOut);
                         }
                     }
                 } else {
                     Logger.debug('ajax request readystate is ', xhr.readyState, 'status ', xhr.status, 'timer', detectInternetStatus);
                 }
             }
             // send xhr request
             xhr.send();
         }
     };
 
     // stop the reconnection attempt
     const stopInternetDetection = () => {
         if (detectInternetStatus !== undefined) {
             Logger.info('stopInternetDetection kill it');
 
             clearInterval(detectInternetStatus);
         } else {
             Logger.info('stopInternetDetection handle is undefined', detectInternetStatus);
         }
     };
 
 
     const clearAll = (callback) => {
         Logger.debug('room-disconnected clear all ');
         // Remove all streams
         if (that.reconnectionAllowed === false) {
             Logger.debug('room-disconnected ---- reconnection not allowed---- clear all normal closer');
             remoteStreams.forEach((stream, id) => {
                 removeStream(stream);
                 remoteStreams.remove(id);
                 if (stream && !stream.failed) {
                     const evt2 = StreamEvent({ type: 'stream-removed', stream });
                     that.dispatchEvent(evt2);
                 }
             });
             remoteStreams = VcxRtcMap();
             // Close Peer Connections
             localStreams.forEach((stream, id) => {
                 if (stream.ifCanvas()) {
                     that.stopCanvas(() => { });
                 }
                 removeStream(stream);
                 localStreams.remove(id);
             });
             localStreams = VcxRtcMap();
 
             // Close socket
             try {
                 Logger.debug(`normal socket closure, disconnect socket room state:${that.state}`);
                 const disconnectSocket = (initiator) => {
                     Logger.debug(`disconnectSocket() room state: ${that.state} initiator: ${initiator}`);
                     if (that.state != DISCONNECTED) {
                         that.state = DISCONNECTED;
                         that.allStreamsActive = false;
                         if (that.streamsHealthTimerId !== 0) {
                           clearInterval(that.streamsHealthTimerId);
                           that.streamsHealthTimerId = 0;
                         }
                         socket.disconnect();
                         socket.state = socket.DISCONNECTED;
                         socket = undefined;
                     }
                     if (callback) {
                         callback(customErrors.error_000);
                     }
                 };
 
                 if (that.state == CONNECTED) {
                     that.state = DISCONNECTING;
                     that.allStreamsActive = false;
                     if (that.streamsHealthTimerId !== 0) {
                       clearInterval(that.streamsHealthTimerId);
                       that.streamsHealthTimerId = 0;
                     }
                     const tempMsg = {};
                     tempMsg.self = true;
                     const timer = setTimeout(disconnectSocket, 1000, 'timer');
                     that.socket.emitEvent(VcxEvent.RoomEvent.drop, tempMsg, (resp) => {
                         clearTimeout(timer); disconnectSocket('disc callback');
                     });
                 } else if (that.state != DISCONNECTING) {
                     disconnectSocket('direct');
                 }
             } catch (error) {
                 Logger.debug('Socket already disconnected');
                 if (callback) {
                     EL.error('room-event', customEvents.event_general_failed, { message: customErrors.error_1163 });
                     callback(customErrors.error_1163);
                 }
             }
         } else {
             /* unexpected socket closure caused the room disconnection
              handle the reconnection case and perform selective steps*/
             // Close PC stream
             //  that.localStreamsBeforeReconnect=localStreams; // store all existing local streams
             Logger.debug('in clear all - unexpected disconnection and the case for reconnect');
             remoteStreams.forEach((remoteStream, id) => {
                 if (remoteStream !== undefined && remoteStream.stream !== undefined) {
                     remoteStream.stream.getTracks().forEach((trackInput) => {
                         const track = trackInput;
                         track.onended = null;
                         track.stop(); // Stops each track in the Stream
                     });
                 } else {
                     Logger.debug('remote stream or media stream is undefined id: ' + id);
                 }
                 if (remoteStream.pc) {
                     remoteStream.pc.close();
                     delete remoteStream.pc;
                 }
                 remoteStreams.remove(id);
             });
 
             localStreams.forEach((localStream, id) => {
                 if (localStream.pc) {
                     localStream.pc.close();
                     delete localStream.pc;
                 }
                 storeLocalStreamForReconnect(localStream);
                 if (localStream && localStream.local) {
                     Logger.info('stream off for internal send data');
                     localStream.off('internal-send-data', sendDataSocketFromStreamEvent);
                 }
 
                 localStreams.remove(id);
             });
 
             socket.state = socket.DISCONNECTED;
             that.state = DISCONNECTED;
             that.allStreamsActive = false;
             if (that.streamsHealthTimerId !== 0) {
               clearInterval(that.streamsHealthTimerId);
               that.streamsHealthTimerId = 0;
             }
             // Send Network disconnected event
             Logger.info('send network disconnected event');
             const networkDisconnected = RoomEvent({ type: 'network-disconnected', error: customErrors.error_1163.result, message: customErrors.error_1163.error });
             that.dispatchEvent(networkDisconnected);
             // end dispatching the event
             that.reconStartTime = Date.now();
             doesConnectionExist();
             detectInternetStatus = setInterval(doesConnectionExist, 15000);
             if (callback) {
                 EL.error('room-event', customEvents.event_general_failed, { message: customErrors.error_1163 });
                 callback(customErrors.error_1163);
             }
         }
     };
 
     // Public functions
     const reconnect = () => {
         Logger.log('reconnect');
         if (socket === undefined && that.reconnectionState === true) {
             Logger.log('reconnect creating a new socket');
 
             // get a new socket
             that.state = DISCONNECTED;// reconnection case , shall we use one more state at socket and room level ?
             that.allStreamsActive = false;
             if (that.streamsHealthTimerId !== 0) {
               clearInterval(that.streamsHealthTimerId);
               that.streamsHealthTimerId = 0;
             }
             Logger.info('reconnect force a new socket');
             socket = Socket(undefined);
             that.socket = socket;
             that.userList.clear();// clear up the userlist
         } else {
             Logger.debug('previous connection is still there or the reconnection state is false');
             that.userList.clear();// clear up the userlist
         }
     };
 
     // It stablishes a connection to the room.
     // Once it is done it throws a RoomEvent("room-connected")
     that.connect = (reconnectInfo = { allow_reconnect: true, number_of_attempts: 3, timeout_interval: 45000 }) => {
         const token = JSON.parse(Base64.decodeBase64(spec.token));
         //set up reconnect parameters
         that.reconnectionAllowed = reconnectInfo.allow_reconnect;
         that.reconnectionTimeOutInterval = reconnectInfo.timeout_interval;
         MAXRECONNECTIONATTEMPT = reconnectInfo.number_of_attempts;
 
             console.log (" connection attempt check :" + that.connectAttempt);
         if ((that.reconnectionState === true) && (that.reconnectAttempt < MAXRECONNECTIONATTEMPT)) {
             that.reconnectAttempt++; // increment reconnection attemp
             token.isReconnecting = true;
             token.reconnectAttempt = that.reconnectAttempt;
             token.oldClientIdForReconnect = that.clientId;
             token.room = that.roomID;
             token.role = that.me.role;
             token.name = that.me.name;
             Logger.info('new token request for the reconnection: ', token);
         } else if (that.connectAttempt >= MAXCONNECTIONATTEMPT ||that.reconnectAttempt >= MAXRECONNECTIONATTEMPT) {
             Logger.info('reconnection attempts exceeded, attempted', that.reconnectAttempt, 'max allowed', MAXRECONNECTIONATTEMPT);
             console.log (" connection timeout happend ssending network-reconnect-timeout");
             that.reconnectionAllowed = false;
             clearAll();
             const reconnectionTimedOut = RoomEvent({ type: 'network-reconnect-timeout', error: customErrors.error_1165.result, message: customErrors.error_1165.error });
             EL.error('room-event', customEvents.event_general_failed, { message: customErrors.error_1165.error });
             that.dispatchEvent(reconnectionTimedOut);
             return;
         } else {
             Logger.info('not the case of reconnection ');
         }
 
         if (that.state !== DISCONNECTED) {
             Logger.warning('Room already connected');
         }
 
         if (token.logId) {
           config.setLocalStorageItem('logID', token.logId);
         }
         // 1- Connect to Client-Controller
         that.state = CONNECTING;
         that.allStreamsActive = false;
         if (that.streamsHealthTimerId !== 0) {
           clearInterval(that.streamsHealthTimerId);
           that.streamsHealthTimerId = 0;
         }
         /* used the following code when dynamic codec was enabled
         if(Connection.browserEngineCheck() === 'safari' ){
             token.mediaConfiguration = VcxEvent.constant.H264_CODEC;
         }else{
             token.mediaConfiguration = VcxEvent.constant.default;
         }*/
         // host type is used by server for setting audio only recording for safari publisher. (safari video MKVs are corrupts)
         token.hostType = config.browser_info.name;
         token.hostVersion = config.browser_info.version;
         token.hostDeviceType = config.browser_info.device_type;
         token.userAgent = config.user_agent;
         token.advancedOptions = spec.options;
         token.version = config.product.version;
         if (spec.maxActiveTalkers != undefined && typeof spec.maxActiveTalkers == 'number'){
           token.maxActiveTalkers = spec.maxActiveTalkers;
         }
         //token.advancedOptions = [{id: 'notify-video-resolution-change', enable : true}];
         that.connectAttempt++;
         console.log ("calling socket connect that.connectAttempt: " + that.connectAttempt);
         socket.connect(token, (response) => {
             Logger.info('socket response: ', response);
             if (response.result === 0) {
                 that.connectAttempt = 0;
                 Logger.info('socket.connect token accepted');
                 that.externalIp = response.connectedIP;
             } else {
                 Logger.info('connect error', response);
                 if (response.result === 4119) {
                     // single participant is trying to reconnect
                     Logger.info('Client is trying to reconnect in a room where all participants are gone', that.reconnectAttempt, 'max allowed', MAXRECONNECTIONATTEMPT);
                     that.reconnectionAllowed = false;
                     clearAll();
                     const reconnectionTimedOut = RoomEvent({ type: 'network-reconnect-timeout', error: customErrors.error_1178.result, message: customErrors.error_1178.error });
                     EL.error('room-event', customEvents.event_general_failed, { message: customErrors.error_1178.error });
                     that.dispatchEvent(reconnectionTimedOut);
                 } else if (response.result === 2101 || response.result === 2102) {
                     console.log('room full response:', response);
                     if(response.result === 2101) {
                         Logger.info('Room is full for moderators');
                     } else {
                         Logger.info('Room is full for participants');
                     }
                     that.reconnectionAllowed = false;
                     clearAll();
                 }
                 const connectEvt = RoomEvent({ type: 'room-error', error: response.result, message: response.msg });
                 that.dispatchEvent(connectEvt);
                 const additionalOptions = {
                     clientId: '',
                     hostType: config.browser_info.name,
                     hostVersion: config.browser_info.version,
                     error: response.msg,
                     externalIp: that.externalIp,
                 };
                 that.createEventLog('clientConnFailed', additionalOptions);
             }
         }, (error) => {
             Logger.error(`Not Connected! Error: ${error}`);
             const connectEvt = RoomEvent({ type: 'room-error', message: error });
             EL.error('room-event', customEvents.event_general_failed, { message: ('clientConnFailed - error') });
             that.dispatchEvent(connectEvt);
             const additionalOptions = {
                 clientId: '',
                 hostType: config.browser_info.name,
                 hostVersion: config.browser_info.version,
                 error,
                 externalIp: that.externalIp,
             };
             that.createEventLog('clientConnFailed', additionalOptions);
         });
     };
 
     ////////////////ReConnect////////////////////////
     ///////////Join Room/////////////
     that.reJoinRoom = () => {
         /* it is similar to forced rejoin for the room
           clear websocket and peer connections if somehow they  are still open, which should not be the case
           and proceed to rejoin while retaining previous room state  also dont mess up existing player state
           make sure to init all local streams( like share, canvas )*/
         Logger.debug('=========== port of hope--- reconnect');
         // disconnect while first connecting, its not reconnection
         if (that.externalIp != ''){ // disconnect while first connecting, its not reconnection
           that.reconnectionState = true; // toDO need to handle
         }
         // initialize all  local streams ,including share and canvas if they were being published before reconnection
         reconnect();
         that.connect();
     };
     ///// End reconnect
 
     // It disconnects from the room, dispatching a new RoomEvent("room-disconnected")
     that.disconnect = (msg) => {
         Logger.debug('that.disconnect() clearing all ');
         // 1- Disconnect from room
         that.reconnectionAllowed = false;
         clearAll((result) => {
             if (msg == undefined) {
                 msg = { cause: customErrors.CC006 };
             }
             const disconnectEvt = RoomEvent({ type: 'room-disconnected', message: msg });
             Logger.debug('that.disconnect() sending room-disconnected event');
             that.dispatchEvent(disconnectEvt);
         });
     };
 
     that.removeTrack = (streamID) => {
         socket.sendSDP('removeTrack', {
             streamId: streamID,
             msg: 'track-removed',
         }, undefined, () => { });
     };
 
     that.getWaitingUserList = (callback) => {
         that.socket.sendMessage('getAwaitedUser', function (response) {
             if (response.result === 0) {
                 for (const key in response.awaitedParticipants) {
                     const user_details = {
                         clientId: response.awaitedParticipants[key].clientId,
                         name: response.awaitedParticipants[key].name,
                     };
                     that.awaitedParticipants.set(response.awaitedParticipants[key].clientId, user_details);
                 }
                 if (callback) callback(response);
             } else {
                 if (callback) callback(response);
             }
         });
     };
 
     that.updateLayout = (layoutOptions, callback) => {
         validateLayoutData(layoutOptions, callback);
     };
 
     const onParticipantFloorEvents = (eventId, eventInfo) => {
         Logger.info(`event: ${eventId}:${eventInfo.clientId}::::${eventInfo.name}`);
         that.cCrequest.push({ clientId: eventInfo.clientId, name: eventInfo.name, type: "raised" });
         const floorEvt = RoomEvent({ type: eventId, users: eventInfo });
         that.dispatchEvent(floorEvt);
     };
     const checkAndRemoveGrantedFloor = (clientId) => {
       for (let cnt=0; cnt < that.cCapprovedHands.length; cnt++) {
         if (that.cCapprovedHands[cnt].clientId == clientId){
           that.cCapprovedHands.splice(cnt,1);
           break;
         }
       }
     }
     const onModeratorFloorEvents = (eventId, eventInfo) => {
             switch (eventId) {
                 case 'floor-granted':
                     if (eventInfo.clientId === that.clientId) that.floorGranted = true;
                     else that.cCapprovedHands.push({clientId: eventInfo.clientId, moderatorId: eventInfo.moderatorId});
                     break;
 
                 case 'floor-invited':
                     if (eventInfo.clientId === that.clientId) that.floorInvited = true;
                     break;
 
                 case 'floor-denied':
                     if (eventInfo.clientId === that.clientId) that.floorGranted = false;
                     break;
 
                 case 'floor-cancelled':
                     if (eventInfo.clientId === that.clientId) that.floorInvited = false;
                     else checkAndRemoveGrantedFloor(eventInfo.clientId);
                     break;
 
                 case 'floor-released':
                   if (eventInfo.clientId === that.clientId) {
                     var lstrm = that.localStreams.getAll();
                     localStreams.forEach((stream, id) => {
                         Logger.info(`${stream.getID()}::::${id}`);
                         that.unpublish(stream, (arg) => {
                             if (arg == true) {
                                 Logger.info('stream has been un-published');
                                 EL.info('room-event', customEvents.event_stream_unpublish_success, { error: {} });
                             } else {
                                 Logger.info('error during stream un-publishing');
                                 EL.error('room-event', customEvents.event_stream_unpublish_failed, { stream });
                             }
                             that.floorGranted = false;
                         });
                     });
                     } else {
                       checkAndRemoveGrantedFloor(eventInfo.clientId);
                     }
                     break;
 
                 default:
                     break;
             }
          //backward compatability for app
         if (eventId == 'floor-released') that.dispatchEvent(RoomEvent({ type: 'release-floor', users: eventInfo }));
         that.dispatchEvent(RoomEvent({ type: eventId, users: eventInfo }));
     };
 
     const onFloorManagementEvents = (arg) => {
         Logger.info(` onFloorManagementEvents: ${JSON.stringify(arg)}`);
         switch (arg.id) {
             case 'floorRequested':
                 onParticipantFloorEvents('floor-requested', arg);
                 break;
 
             case 'floorCancelled':
                 onParticipantFloorEvents('floor-cancelled', arg);
                 break;
 
             case 'floorFinished':
                 onParticipantFloorEvents('floor-finished', arg);
                 break;
 
             case 'floorRejected':
                 that.floorInvited = false;
                 onParticipantFloorEvents('floor-rejected', arg);
                 break;
 
             case 'floorAccepted':
                 onParticipantFloorEvents('floor-accepted', arg);
                 break;
 
 
             case 'inviteToFloor':
                 onModeratorFloorEvents('floor-invited', arg);
                 break;
 
             case 'floorGranted':
                 onModeratorFloorEvents('floor-granted', arg);
                 break;
 
             case 'floorDenied':
                 onModeratorFloorEvents('floor-denied', arg);
                 break;
 
             case 'floorReleased':
                 onModeratorFloorEvents('floor-released', arg);
                 break;
 
             case 'cancelFloorInvite':
                 onModeratorFloorEvents('floor-invite-cancelled', arg);
                 break;
 
             default:
                 break;
         }
     };
 
     const onHardmuteOne = (arg) => {
         Logger.info(arg);
         const floorReqEvt = RoomEvent({ type: 'hard-mute', users: arg });
         that.dispatchEvent(floorReqEvt);
     };
 
     const onHardUnmuteRoom = (arg, callback) => {
         hardMuteMediaDevices(false, true, false, true, callback, true, { type: 'hard-unmute-room', message: arg });
         that.mute = false;
     };
 
     const onHardmuteRoom = (arg, callback) => {
         hardMuteMediaDevices(true, true, false, true, callback, true, { type: 'hard-mute-room', message: arg });
         that.mute = true;
     };
 
     that.enableKnock = (enable, callback) => {
         if ((enable !== undefined) && (typeof enable === 'boolean')) {
             that.socket.emitEvent('enableKnock', enable, (response) => {
                 Logger.info(`enableKnock response${JSON.stringify(response)}`);
                 if (response.result === 0 && enable === false) that.awaitedParticipants.clear();
                 if (callback) callback(response);
             });
         } else {
             callback(false);
         }
     };
 
     that.openFloor = (enable, callback) => {
         if ((enable !== undefined) && (typeof enable === 'boolean')) {
             that.socket.emitEvent('openFloor', enable, (response) => {
                 Logger.info(`openFloor response${JSON.stringify(response)}`);
                 if (response.result === 0) that.floorOpen = enable;
                 if (callback) callback(response);
             });
         } else {
             callback(false);
         }
     };
 
 
 
 
     const onRoomAwaited = (arg) => {
         const evt = RoomEvent({ type: 'room-awaited', message: 'waiting for moderator approval' });
         that.dispatchEvent(evt);
     };
 
     const onUserAwaited = (arg) => {
         const user_details = { clientId: arg.clientId, name: arg.name};
         if(arg.data) user_details.data = arg.data;
         that.awaitedParticipants.set(arg.clientId, user_details);
         const evt = RoomEvent({ type: 'user-awaited', message: { user: user_details } });
         that.dispatchEvent(evt);
     };
 
     that.approveAwaitedUser = (client, callback = () => { }) => {
         if (typeof callback === 'function') {
             that.socket.emitEvent('user-allowed', client, (result, error) => {
                 if (result === null) {
                     Logger.error('Error on knock approve request', error);
                     return;
                 }
                 that.awaitedParticipants.delete(client);
 
                 callback(result, error);
             });
         } else {
             Logger.error('approveAwaitedUser() invalid param - callback');
         }
     };
 
     that.denyAwaitedUser = (client, callback = () => { }) => {
         if (typeof callback === 'function') {
             that.socket.emitEvent('user-denied', client, (result, error) => {
                 if (result === null) {
                     Logger.error('Error on knock deny request', error);
                     return;
                 }
                 that.awaitedParticipants.delete(client);
 
                 callback(result, error);
             });
         } else {
             Logger.error('denyAwaitedUser() invalid param - callback');
         }
     };
 
 
     const onRoomConnected = (response) => {
         Logger.info('-----------onRoomConnected-----------');
         let stream;
         const streamList = [];
         const streams = response.streams || [];
         const roomId = response.id;
         const userList = response.userList;
         const roomJson = response.room;
 
         that.me = response.user || {};
         that.roomSettings = response.room.settings || {};
         that.mute = response.room.mute;
         that.mediaRecord = response.mediaRecord;
         that.subscription = response.subscription;
         that.mode = response.room.settings.mode;
         that.share_override_room = response.room.settings.screen_share_override || false;
         if(!config.csp_enabled) {
             document.head.append(statsStyle);
         }
         if (that.mode === 'lecture' && response.user.role === 'moderator') {
             if (response.raisedHands.length > 0) {
                 response.raisedHands.forEach((item) => {
                     that.cCrequest.push(item);
                 });
             }
             if (response.floorInvites.length > 0) {
                 response.floorInvites.forEach((item) => {
                     that.cCrequest.push(item);
                 });
             }
             if (response.approvedHands.length > 0) {
                 response.approvedHands.forEach((item) => {
                     that.cCapprovedHands.push(item);
                 });
             }
         }
         that.activeTalker = roomJson.settings.active_talker;
         for (const key in response.awaitedParticipants) {
             const user_details = {
                 clientId: response.awaitedParticipants[key].clientId,
                 name: response.awaitedParticipants[key].name,
             };
             that.awaitedParticipants.set(response.awaitedParticipants[key].clientId, user_details);
         }
 
         that.iceServers = response.iceServers;
         that.state = CONNECTED;
         that.mediaConfiguration = response.mediaConfiguration;
         if (response.nonTalkerMediaParams) that.nonTalkerMediaParams = response.nonTalkerMediaParams;
         that.videoMutedUsers = response.videoMutedUsers;
         spec.defaultVideoBW = response.defaultVideoBW;
         spec.maxVideoBW = response.maxVideoBW;
         that.clientId = response.clientId;
         that.maxVideoLayers = response.maxVideoLayers || 0;
         //if (that.maxVideoLayers > 1) that.videoLayersBWRange = response.videoLayersBWRange
         that.maxCanvasRefreshRate = response.maxCanvasRefreshRate || 0;
         that.share = response.room.share;
         that.locked = response.room.locked || false;
         that.waitRoom = response.room.waitRoom || false;
         that.knockEnabled = response.room.knockEnabled || false;
         that.userAudioTalkerCount = response.numAudioTalkers || 0;
         that.userVideoTalkerCount = response.numVideoTalkers || 0;
         spec.minVideoBW = response.minVideoBW;
         spec.maxVideoFps = response.maxVideoFps;
         if (response.internetDetectionUrl != undefined) {
             that.internetDetectionUrl = response.internetDetectionUrl;
         } else {
             that.internetDetectionUrl = config.internetDetectionUrl;
         }
         if (response.room.openFloor !== undefined)
             that.floorOpen = response.room.openFloor;
         else
             that.floorOpen = true;
         config.setVideoBwQualityMapper(response.videoBitrateQualityMap);
 
         // Set clientId and utilToken in event logger if token is received
         EL.setClientId(response.clientId);
         if (response.utilToken) {
             EL.setEventLoggerToken(response.utilToken);
         }
 
         // if file sharing service and subscription is enabled then populate and setup file sharing service
         // ToDO  refactor ;- set completed object from signalling server itself , insted of manipulating here
         if (response.room.fileShareService !== undefined) {
             let fileShareService = {};
             fileShareService = response.room.fileShareService;
             const fsCallInfo = {};
             fsCallInfo.call_num = response.clientId;
             fsCallInfo.room_id = response.id;
             fsCallInfo.service_id = response.room.service_id;
             fsCallInfo.conf_num = response.room.conf_num;
             fsCallInfo.userName = response.user.name || '';
             maxFileSize = response.room.fileShareService.maxSize;
             fileShareService.callInfo = fsCallInfo;
             setFileShareServiceEndPoint(fileShareService);
         }
         // is a streaming client
         if (response.isStreamingClient != undefined) {
             if (response.isStreamingClient === true) {
                 Logger.info('is a streaming client');
                 that.isStreamingClient = true;
             } else {
                 Logger.debug('NOT A S T Client');
                 that.isStreamingClient = false;
             }
         } else {
             Logger.info(' server does not support file sharing ', response.room.fileShareService);
         }
 
 
         // 2- Retrieve list of streams
         const streamIndices = Object.keys(streams);
         for (let index = 0; index < streamIndices.length; index += 1) {
             const arg = streams[streamIndices[index]];
             stream = Stream(that.Connection, {
                 streamID: arg.id,
                 local: false,
                 audio: arg.audio,
                 video: arg.video,
                 data: arg.data,
                 screen: arg.screen,
                 canvas: (!(typeof arg.canvas === 'undefined' || arg.canvas === false)),
                 attributes: arg.attributes,
             });
             streamList.push(stream);
             remoteStreams.add(arg.id, stream);
         }
         // 3 - Update RoomID
         that.roomID = roomId;
         Logger.info(`Connected to room ${that.roomID}`);
         for (const user in userList) {
             that.userList.set(userList[user].clientId, userList[user]);
         }
         that.getMaxTalkers((callback) => {
             that.talkerCount = callback.maxTalkers;
         });
 
 
         const roomMeta = {
             conf_num: roomJson.conf_num,
             name: roomJson.name,
             owner_ref: roomJson.owner_ref,
             mode: roomJson.settings.mode,
             moderators: roomJson.settings.moderators,
             participants: roomJson.settings.participants,
             auto_recording: roomJson.settings.auto_recording,
             canvas: roomJson.settings.canvas,
             description: roomJson.settings.description,
             created: roomJson.created,
             mute: roomJson.mute,
             quality: roomJson.settings.quality,
             screen_share: roomJson.share,
             locked: roomJson.locked,
             wait_room: roomJson.wait_room,
             duration: roomJson.remainingDuration,
             analyzer: roomJson.analyzer,
             screen_share_override: roomJson.settings.screen_share_override,
         };
         that.screenResolutionRange = (response.room.screenResolutionRange != null) ? response.room.screenResolutionRange : config.screen_resolution_range[roomMeta.quality];
         if (that.selectedSpeakerId != undefined) {
             validSpeakerDevice(that.selectedSpeakerId, (valid) => {
                 if (!valid) that.selectedSpeakerId = undefined;
                 Logger.error(`selected speaker id valid : ${valid}`);
             });
         }
         Logger.debug(`room-connected event - room Info : ${JSON.stringify(roomMeta)}`);
         const connectEvt = RoomEvent({
             type: 'room-connected', streams: streamList, users: userList, room: roomMeta, me: that.me, mediaRecord: that.mediaRecord,
         });
         that.dispatchEvent(connectEvt);
 
         Logger.info('that.externalIp: ', that.externalIp);
         that.reconnectClientName = response.user.name;
         const additionalOptions = {
             clientId: response.clientId,
             clientName: response.user.name,
             hostType: config.browser_info.name,
             hostVersion: config.browser_info.version,
             externalIp: that.externalIp,
         };
         that.createEventLog('clientConnSuccess', additionalOptions);
     };
     const mediaConnectionTimeout = () => {
       let health = true;
       if (that.allStreamsActive){
         checkAndProcessStreamsHealth();
         return;
       }
       console.log (" ======== mediaConnectionTimeout() ======= ");
       let rStreams = remoteStreams.getAll();
       const rKeys = Object.keys(rStreams);
       for (let index = 0; index < rKeys.length; index += 1) { 
         if (checkStreamState(rStreams[rKeys[index]]) == false) {
           health = false;
           console.log (" mediaConnectionTimeout() BAD subscriber stream health streamId: " + rKeys[index]);
           break;
         }
       }
       if (health){
         let lStreams = remoteStreams.getAll();
         const lKeys = Object.keys(lStreams);
         for (let index = 0; index < lKeys.length; index += 1) { 
           if (checkStreamState(lStreams[lKeys[index]]) == false) {
             health = false;
             console.log (" mediaConnectionTimeout() BAD publisher stream health streamId: " + lKeys[index]);
             break;
           }
         }
       }
       if (!health){
         console.log (" mediaConnectionTimeout() health is bad.. rejoin room  ");
         that.reJoinRoom();
       }
     };
 
     const onRoomDisconnected = (msg) => {
         //that.reconnectionAllowed = false;
         //clearAll();
         Logger.info(` onRoomDisconnected() : calling that.disconnect  with msg : ${JSON.stringify(msg)}`);
         if (msg == undefined) {
             msg = customErrors.CC002;
         }
         that.disconnect(msg);
     };
 
     const hardMuteMic = (stream, muteOn, raiseEvent, delay, callback) => {
         if (stream.hardAudioMuted != muteOn) {
             const muteMicCallback = (resp) => {
                 // if local mute happend and hardmute is set, hardmute set the preference and send user indication
                 callback(((resp.result === customErrors.error_1177.result) ? customErrors.error_000 : resp));
             };
             stream.hardAudioMuted = muteOn;
             if (muteOn) {
                 stream.muteAudio(muteMicCallback, raiseEvent, delay);
             } else {
                 stream.unmuteAudio(muteMicCallback, raiseEvent, delay);
             }
         } else {
             EL.error('room-event', customEvents.event_general_failed, { message: customErrors.error_1177.error });
             callback(customErrors.error_1177);
         }
     };
 
     const hardMuteCam = (stream, muteOn, raiseEvent, delay, callback) => {
         if (stream.hardVideoMuted != muteOn) {
             const muteCamCallback = (resp) => {
                 // if local mute happend and hardmute is set, hardmute set the preference and send user indication
                 callback(((resp.result === customErrors.error_1177.result) ? customErrors.error_000 : resp));
             };
             stream.hardVideoMuted = muteOn;
             if (muteOn) {
                 stream.muteVideo(muteCamCallback, raiseEvent, delay);
             } else {
                 stream.unmuteVideo(muteCamCallback, raiseEvent, delay);
             }
         } else {
             EL.error('room-event', customEvents.event_general_failed, { message: customErrors.error_1177.error });
             callback(customErrors.error_1177);
         }
     };
 
     const setMediaDeviceMuteState = (muteOn, isHard, media, sendServerEvent, roomEvent, eventData, callback) => {
         if (!that.localStreams.size) {
             EL.error('room-event', customEvents.event_general_failed, { message: customErrors.error_1159.error });
             callback(customErrors.error_1159);
             return;
         }
 
         const checkAndDispatchEvent = (streamToSend, resp, eventData) => {
             if ((resp.result === customErrors.error_000.result) && (eventData !== undefined)) {
                 if (streamToSend) {
                     const evt = StreamEvent(eventData);
                     stream.dispatchEvent(evt);
                 } else {
                     const evt = RoomEvent(eventData);
                     that.dispatchEvent(evt);
                 }
             }
         };
 
         that.localStreams.forEach((stream, id) => {
             if (((media === 'audio') && stream.ifAudio() && (!isHard || (stream.hardAudioMuted != muteOn))) ||
                 ((media === 'video') && stream.ifVideo() && (!isHard || (stream.hardVideoMuted != muteOn)))) {
                 if (media === 'audio') {
                     if (isHard) {
                         stream.hardAudioMuted = muteOn;
                     }
                 } else if (isHard) {
                     stream.hardVideoMuted = muteOn;
                 }
 
                 stream.setMediaDeviceMuteState(
                     muteOn, (media === 'audio'), (media === 'video'), sendServerEvent,
                     (resp) => { checkAndDispatchEvent((roomEvent ? undefined : stream), resp, eventData); callback(resp); },
                 );
                 return;
             }
             if (((media === 'audio') && stream.ifAudio()) || ((media === 'video') && stream.ifVideo())) {
                 EL.error('room-event', customEvents.event_general_failed, { message: customErrors.error_1177.error });
                 callback(customErrors.error_1177);
             }
         });
     };
 
     const hardMuteMediaDevices = (muteOn, audio, video, sendServerEvent, callback, roomEvent, eventData) => {
         let eventSent = false;
         const checkAndDispatchStreamEvent = (stream, resp, roomEvent, eventData) => {
             Logger.info(`hardMuteMediaDevices callback resp : ${JSON.stringify(resp)}`);
             if ((resp.result === customErrors.error_000.result) && eventData) {
                 if (roomEvent) {
                     const evt = RoomEvent(eventData);
                     that.dispatchEvent(evt);
                 } else {
                     const evt = StreamEvent(eventData);
                     stream.dispatchEvent(evt);
                 }
                 eventSent = true;
             }
         };
         Logger.info(`hardMuteMediaDevices muteOn: ${muteOn} audio: ${audio} video: ${video} sendsendServerEvent : ${sendServerEvent}`);
         that.localStreams.forEach((stream, id) => {
             if (audio && stream.ifAudio()) {
                 if (muteOn) {
                     stream.muteAudio((resp) => {
                         checkAndDispatchStreamEvent(stream, resp, roomEvent, eventData); callback(resp);
                     }, sendServerEvent, 0, false);
                 } else {
                     stream.unmuteAudio((resp) => {
                         checkAndDispatchStreamEvent(stream, resp, roomEvent, eventData); callback(resp);
                     }, sendServerEvent, 0, false);
                 }
                 return;
             }
             if (video && stream.ifVideo()) {
                 if (muteOn) {
                     stream.muteVideo((resp) => {
                         checkAndDispatchStreamEvent(stream, resp, roomEvent, eventData); callback(resp);
                     }, sendServerEvent, 0, false);
                 } else {
                     stream.unmuteVideo((resp) => {
                         checkAndDispatchStreamEvent(stream, resp, roomEvent, eventData); callback(resp);
                     }, sendServerEvent, 0, false);
                 }
             }
         });
         if (!eventSent && roomEvent && eventData) {
           const evt = RoomEvent(eventData);
           that.dispatchEvent(evt);
         }
         if (callback) {
             EL.error('room-event', customEvents.event_general_failed, { message: customErrors.error_1159.error });
             callback(customErrors.error_1159);
         }
     };
 
     const mediaDeviceMuteOnJoin = (stream, audioInfo, videoInfo, raiseEvent) => {
         const logMessage = (callingFn, resp) => {
             if (resp.result === customErrors.error_000.result) {
                 Logger.info(`mediaDeviceMuteOnJoin() ${callingFn} audio: ${JSON.stringify(audioInfo)} video: ${JSON.stringify(videoInfo)} success`);
             } else {
                 Logger.error(`mediaDeviceMuteOnJoin() ${callingFn} audio: ${JSON.stringify(audioInfo)} video: ${JSON.stringify(videoInfo)} failed. result: ${JSON.stringify(resp)}`);
             }
         };
         if (videoInfo.local) {
           stream.muteVideo((resp) => { logMessage('videoSelfMuteCallback', resp); }, raiseEvent, 1000, true);
         }else if (stream.selfMuteVideo){
           stream.unmuteVideo((resp) => { logMessage('videoSelfUnmuteCallback', resp); }, raiseEvent, 1000, true);
         }
         if (videoInfo.hard) {
           stream.muteVideo((resp) => { logMessage('videoHardMuteCallback', resp); },raiseEvent, 1000, false);
         }else if (stream.hardVideoMuted){
           stream.unmuteVideo((resp) => { logMessage('videoHardUnmuteCallback', resp); },raiseEvent, 1000, false);
         }
         if (audioInfo.local) {
           stream.muteAudio((resp) => { logMessage('AudioSelfMuteCallback', resp); }, raiseEvent, 1000, true);
         }else if (stream.selfMuteAudio){
           stream.unmuteAudio((resp) => { logMessage('AudioSelfUnmuteCallback', resp); }, raiseEvent, 1000, true);
         }
         if (audioInfo.hard) {
           stream.muteAudio((resp) => { logMessage('AudioHardMuteCallback', resp); },raiseEvent, 1000, false);
         }else if (stream.hardAudioMuted){
           stream.unmuteAudio((resp) => { logMessage('AudioHardUnmuteCallback', resp); },raiseEvent, 1000, false);
         }
         /*
         let audioMuteCallback = (resp) => {
             logMessage("audioMuteCallback", resp);
             //do video unmute done after 1 sec to avoid blank video on both local view and remote subscribers
             if (!videoInfo.mute) {
                 setTimeout(setMediaDeviceMuteState, 1000, false, videoInfo.hard, "video", false, true, undefined,
                     (resp) => { logMessage("videoUnmuteCallback", resp); });
             }
         };
         let videoMuteCallback = (resp) => {
             logMessage("videoMuteCallback", resp);
             //do audio hard mute
             if (audioInfo.mute)
                 setMediaDeviceMuteState(true, audioInfo.hard, "audio", true, true, audioInfo.eventInfo, audioMuteCallback);
         };
         // hard-mute-room event not sending to app as  room mute sent in room-connected event
         //replace track for audio causing blank on remote. so in this case enable to false
         if (audioInfo.mute || videoInfo.mute)
             setMediaDeviceMuteState(videoInfo.mute, videoInfo.hard, "video", videoInfo.hard ? false : true, true,
                 (videoInfo.mute ? videoInfo.eventInfo : undefined), videoMuteCallback);*/
     };
 
     const onHardMuteAudio = (arg, callback) => {
       hardMuteMediaDevices(true, true, false, true, callback, true, { type: 'hardmute-user-audio', message: arg });
     };
 
     const onHardUnmuteAudio = (arg, callback) => {
       hardMuteMediaDevices(false, true, false, true, callback, true,{ type: 'hardunmute-user-audio', message: arg });
     };
 
     const onHardMuteVideo = (arg, callback) => {
       hardMuteMediaDevices(true, false, true, true, callback, true, { type: 'hardmute-user-video', message: arg });
     };
 
     const onHardUnmuteVideo = (arg, callback) => {
       hardMuteMediaDevices(false, false, true, true, callback, true, { type: 'hardunmute-user-video', message: arg });
     };
 
     const onShareStarted = (arg) => {
         adjustMainVideoQuality(true, that.canvasStatus);
         const evt = RoomEvent({ type: 'share-started', message: { clientId: arg.clientId, name: arg.name, streamId: arg.streamId, layout: arg.layout } });
         that.shareStatus = true;
         if (that.clientId == arg.clientId) {
             that.isSharingClient = true;
         }
         Logger.debug(` share-started event : ${JSON.stringify(evt)}`);
         that.dispatchEvent(evt);
     };
 
     const onSwitchCodec = (arg) => {
         if (arg.result === 0 && arg.mediaConfiguration !== that.mediaConfiguration) {
             that.mediaConfiguration = arg.mediaConfiguration;
             that.localStreams.forEach((stream, streamID) => {
                 stream.resetMediaConfiguration(arg.mediaConfiguration);
             });
         }
     };
 
     const onStopSharing = (arg) => {
         Logger.info('Stop sharing requested by client: ', arg.clientId);
         that.forcedStopSharing = true;
         console.log('that.forcedStopSharing: ', that.forcedStopSharing);
         if (that.isSharingClient) {
             Logger.info('stopScreenShare for current client');
             that.stopScreenShare(function (res) {
                 if (res.result == 0) {
                 }
             });
         }
         if (that.isCanvasSharingClient == true) {
             Logger.info('stopCanvasShare for current client');
             that.stopAnnotation(function (res) {
                 if (res.result == 0) {
                 }
             });
         }
     };
 
     const onUpdateLayout = (arg) => {
         Logger.info('Update Layout requested by client: ', arg.clientId);
         if(that.clientId != arg.clientId) {
             const evt = RoomEvent({ type: 'layout-updated', message: arg });
             that.dispatchEvent(evt);
         }
     };
 
     const onShareStopped = (arg) => {
         adjustMainVideoQuality(false, that.canvasStatus);
         const additionalOptions = {
             streamType: 'share',
             streamId: arg.streamId,
             negotiatedCodecs: {
                 video: {
                     codec: (that.mediaConfiguration === 'default' || that.mediaConfiguration === 'Default') ? 'VP8' : that.mediaConfiguration,
                 },
                 audio: {
                     codec: 'OPUS',
                 },
             },
             externalIp: that.externalIp,
         };
         var evt;
         console.log('that.forcedStopSharing: ', that.forcedStopSharing);
         if(that.forcedStopSharing == false) {
             evt = RoomEvent({ type: 'share-stopped', message: { clientId: arg.clientId, name: arg.name, streamId: arg.streamId } });
         } else {
             evt = RoomEvent({ type: 'share-stopped', message: { clientId: arg.clientId, name: arg.name, streamId: arg.streamId, stoppedBy: 'moderator'} });
         }
         that.forcedStopSharing = false;
         that.shareStatus = false;
         Logger.debug(` share-stopped event : ${JSON.stringify(evt)}`);
         console.log(` share-stopped event : ${JSON.stringify(evt)}`);
         that.dispatchEvent(evt);
         Logger.info('additionalOptions: ', additionalOptions);
         that.createEventLog('clientStreamShareStopped', additionalOptions);
         that.isSharingClient = false;
 
         if(that.isOverRidingShare) {
             console.log('onShareStopped start sharing for this client');
             let streamShare = that.startScreenShare(that.shareOverRideCallback);
             that.ScreenSharelocalStream = streamShare;
             const evt = RoomEvent({ type: 'start-new-screen-share', message: { clientId: that.clientId } });
             that.dispatchEvent(evt);
             that.isOverRidingShare = false;
         }
     };
 
 
     const onScreenShareOverride = (arg) => {
         console.log('onScreenShareOverride');
         if(that.isSharingClient) {
             that.stopScreenShare(function (res) {
                 console.log('stopScreenShare response: ', res);
                 if (res.result == 0) {
                 }
             });
 
             const evt = RoomEvent({ type: 'stop-old-screen-share', message: { clientId: that.clientId } });
             that.dispatchEvent(evt);
 
         }
     };
 
     const onUserAudioMuted = (arg) => {
         /*that.remoteStreams.forEach(function(value,key){
             if(value.clientId === arg.clientId){
                 const evt2 = StreamEvent({ type: 'user-audio-muted', stream: value});
                 value.dispatchEvent(evt2);
             }
         });*/
         const user = that.userList.get(arg.clientId);
         user.audioMuted = arg.user.audioMuted;
         that.userList.set(arg.clientId, arg.user);
 
         const evt = UserEvent({ type: 'user-audio-muted', clientId: arg.clientId });
         that.dispatchEvent(evt);
     };
 
     const onUserAudioUnmuted = (arg) => {
         /*that.remoteStreams.forEach(function(value,key){
             if(value.clientId === arg.clientId){
                 const evt2 = StreamEvent({ type: 'user-audio-unmuted', stream: value});
                 value.dispatchEvent(evt2);
             }
         });*/
         const user = that.userList.get(arg.clientId);
         user.audioMuted = arg.user.audioMuted;
         that.userList.set(arg.clientId, arg.user);
 
         const evt = UserEvent({ type: 'user-audio-unmuted', clientId: arg.clientId });
         that.dispatchEvent(evt);
     };
 
     const onUserVideoMuted = (arg) => {
         /*that.remoteStreams.forEach(function(value,key){
             if(value.clientId === arg.clientId){
                 const evt2 = StreamEvent({ type: 'user-video-muted', stream: value});
                 value.dispatchEvent(evt2);
             }
         });*/
         const user = that.userList.get(arg.clientId);
         user.videoMuted = arg.user.videoMuted;
         that.userList.set(arg.clientId, arg.user);
 
         const evt = UserEvent({ type: 'user-video-muted', clientId: arg.clientId });
         that.dispatchEvent(evt);
     };
 
     const onUserVideoUnmuted = (arg) => {
         /*that.remoteStreams.forEach(function(value,key){
             if(value.clientId === arg.clientId){
                 const evt2 = StreamEvent({ type: 'user-video-unmuted', stream: value});
                 value.dispatchEvent(evt2);
             }
         });*/
 
         const user = that.userList.get(arg.clientId);
         user.videoMuted = arg.user.videoMuted;
         that.userList.set(arg.clientId, arg.user);
 
         const evt = UserEvent({ type: 'user-video-unmuted', clientId: arg.clientId });
         that.dispatchEvent(evt);
     };
 
     const adjustMainVideoQuality = (shareOn, canvasOn) => {
         that.localStreams.forEach((stream) => {
             if (!stream.ifCanvas() && !stream.ifScreen() && stream.video && stream.local) {
                 if (that.maxVideoLayers > 1) {
                     const quality = (shareOn || canvasOn) ? 'ND' : token.roomMeta.settings.quality;
                     const maxVideoBitrates = {
                         0: config.video_bandwidth_range[quality][2].max * 1000,
                         1: config.video_bandwidth_range[quality][1].max * 1000,
                         2: config.video_bandwidth_range[quality][0].max * 1000,
                     };
                     Logger.info(`updating main video simulcast bps: ${JSON.stringify(maxVideoBitrates)}`);
                     stream.updateSimulcastLayersBitrate(maxVideoBitrates);
                 }
             }
         });
     };
     // It publishes the stream provided as argument. Once it is added it throws a
     // StreamEvent("stream-added").
     that.publish = (streamInput, optionsInput = {}, callback = () => { }) => {
         if (typeof callback === 'function') {
             const stream = streamInput;
             const options = optionsInput;
             if (that.subscription && ((!that.subscription.audio_video && streamInput.video) ||
                 (!that.subscription.audio_only && !that.subscription.audio_video && streamInput.audio) ||
                 (!that.subscription.audio_video && streamInput.canvas) ||
                 (!that.subscription.audio_video && streamInput.share))) {
                 Logger.error(`Licence error : feature not supported subscription - av: ${that.subscription.audio_video} audio: ${that.subscription.audio_only} canvas: ${that.subscription.audio_video} share: ${that.subscription.audio_video} req audio: ${streamInput.audio} video: ${streamInput.video} share: ${streamInput.share} canvas: ${streamInput.canvas}`);
                 EL.error('room-event', customEvents.event_general_failed, { message: customErrors.error_1170.error });
                 callback(customErrors.error_1170);
                 return;
             }
 
             if (streamInput.video && !streamInput.canvas && !streamInput.share) {
                 if (stream.videoStream == null) {
                     streamInput.video = false;
                 }
                 else {
                     let configRoomVideoRes = streamInput.videoSize == undefined ? true : false;
                     const res = validateVideoResolution(streamInput, true);
                     if (res.result !== customErrors.error_000.result) {
                         Logger.error(` Failed : room.publish video size invalid video size req: ${streamInput.videoSize} default : ${JSON.stringify(videoResolutionRange)}`);
                         EL.error('room-event', customEvents.event_general_failed, { message: `room.publish video size invalid video size req: ${streamInput.videoSize} default : ${JSON.stringify(videoResolutionRange)}` });
                         callback(res);
                         return;
                     }
                     if ((configRoomVideoRes && streamInput.videoSize !== undefined && 
                          config.browser_info.device_type !== 'mobile') && 
                         ((streamInput.videoSize[0] != config.video_resolution_range["Default"].min.wdith) ||
                          (streamInput.videoSize[1] != config.video_resolution_range["Default"].min.height) ||
                          (streamInput.videoSize[2] != config.video_resolution_range["Default"].min.wdith) ||
                          (streamInput.videoSize[3] != config.video_resolution_range["Default"].max.height))){ 
                       stream.setVideoQualityParams(streamInput.videoSize[0], streamInput.videoSize[1],
                                                   streamInput.videoSize[2],streamInput.videoSize[3])
                     }
                     streamInput.maxVideoLayers = that.maxVideoLayers;
                 }
             }
             stream.userRequestOptions = JSON.parse(JSON.stringify(optionsInput));
 
             if (streamInput.audio && !streamInput.canvas && !streamInput.share) {
                 if (stream.audioStream == null)
                     streamInput.audio = false;
             }
 
             locStrm = streamInput;
             if (that.reconnectionState === false) {
                 if (streamInput.ifScreen()) {
                     //sharePublishOptions.forceTurn =  options.forceTurn ? options.forceTurn :  false;
                     options.forceTurn = sharePublishOptions.forceTurn;
                 } else if (streamInput.ifCanvas()) {
                     //canvasPublishOptions.forceTurn =  options.forceTurn ? options.forceTurn :  false;
                     options.forceTurn = canvasPublishOptions.forceTurn;
                     canvasPublishOptions.canvasType = options.canvasType;
                 } else {
                     avOptions.publish.forceTurn = options.forceTurn ? options.forceTurn : false;
                     sharePublishOptions.forceTurn = avOptions.publish.forceTurn;
                     canvasPublishOptions.forceTurn = avOptions.publish.forceTurn;
                     if (options.maxVideoBW || options.minVideoBW || options.maxVideoFps) {
                         streamInput.setVideoParamsRange(options.maxVideoBW, options.minVideoBW, options.maxVideoFps, undefined, false);
                     }
                     if (spec.maxVideoBW || spec.minVideoBW || spec.maxVideoFps) {
                         streamInput.setVideoParamsRange(spec.maxVideoBW, spec.minVideoBW, spec.maxVideoFps, undefined, true);
                     }
                     Logger.info(` options.maxVideoBW: ${options.maxVideoBW} spec.maxVideoBW: ${spec.maxVideoBW}`);
                     if (options.maxVideoBW == undefined) {
                         options.maxVideoBW = spec.maxVideoBW;
                         options.minVideoBW = spec.minVideoBW;
                     }
                 }
             } else if (streamInput.ifScreen()) {
                 options.forceTurn = sharePublishOptions.forceTurn;
             } else if (streamInput.ifCanvas()) {
                 options.forceTurn = canvasPublishOptions.forceTurn;
                 options.canvasType = canvasPublishOptions.canvasType;
             } else {
                 options.forceTurn = avOptions.publish.forceTurn;
             }
             options.maxVideoBW = options.maxVideoBW || spec.defaultVideoBW;
             if (options.maxVideoBW > spec.maxVideoBW) {
                 options.maxVideoBW = spec.maxVideoBW;
             }
 
             if (options.minVideoBW === undefined) {
                 options.minVideoBW = 0;
             }
 
             if (options.minVideoBW > spec.defaultVideoBW) {
                 options.minVideoBW = spec.defaultVideoBW;
             }
             if (options.forceTurn) { stream.forceTurn = options.forceTurn; }
 
             options.simulcast = options.simulcast || false;
 
             options.muteStream = {
                 audio: stream.ifCanvas() ? true : stream.audioMuted,
                 video: stream.videoMuted,
             };
             that.muteAudioOnJoin = !!options.audioMuted;
             that.muteVideoOnJoin = !!options.videoMuted;
             Logger.debug(`Publish forceTurn: ( ${options.forceTurn},${avOptions.publish.forceTurn} ) reconnect state: ${that.reconnectionState}`);
 
             /*if(that.mute && that.me.role === 'participant' && !stream.ifScreen())
             {
                 stream.muteAudioNotSelf();
             }*/
 
             // 1- If the stream is not local or it is a failed stream we do nothing.
             // if (stream && stream.local && !stream.failed && !localStreams.has(stream.getID())) {}
             if (stream && stream.local && !stream.failed) {
                 if (that.waitRoom) {
                     Logger.error('Publish() : failed Moderator not present and  waiting for moderator ');
                     EL.error('room-event', customEvents.event_general_failed, { message: customErrors.error_1130.error });
                     callback(customErrors.error_1130);
                     return;
                 }
                 // 2- Publish Media Stream to Client-Controller
                 if (stream.ifMedia()) {
                     if (stream.ifExternal()) {
                         publishExternal(stream, options, callback);
                     } else {
                         if (that.videoMuteOnJoin != undefined) delete that.videoMuteOnJoin;
                         if (that.audioMuteOnJoin != undefined) delete that.audioMuteOnJoin;
                         if (((that.reconnectionState || stream.reconnect ) && !stream.ifCanvas() && !stream.ifScreen())){
                           that.audioMuteOnJoin = { local: stream.selfMuteAudio, hard: stream.hardAudioMuted};
                           if(stream.selfMuteVideo || stream.hardVideoMuted) {
                             const publishVideoOnunmuteVideo = (result) => {
                                 if (result.result == 0) {
                                     stream.muteVideo(() => { }, false, 0, true, true);
                                     Logger.info('Publish stream options after unmute video success');
                                 } else {
                                     Logger.error(`Publish stream options after unmute video failed :${JSON.stringify(result)}`);
                                 }
                                 publishVcxRtc(stream, options, callback);
                             };
                             that.videoMuteOnJoin = { local: stream.selfMuteVideo, hard: stream.hardVideoMuted };
                             stream.unmuteVideo(publishVideoOnunmuteVideo, false, 0, !stream.hardVideoMuted);
                           }else{
                             publishVcxRtc(stream, options, callback);
                           }
                         } else {
                             Logger.info('Publish stream options : ', options);
                             publishVcxRtc(stream, options, callback);
                         }
                     }
                 } else if (stream.ifData()) {
                     publishData(stream, options, callback);
                 }
             } else {
                 Logger.error('Trying to publish invalid stream');
                 EL.info('room-event', customEvents.event_stream_publish_failed, { stream });
                 callback(undefined, 'Invalid Stream');
                 const additionalOptions = {
                     streamId: stream.getID(),
                     selectedCandidates: { local: '', remote: '' },
                     negotiatedCodecs: {
                         video: {
                             codec: (that.mediaConfiguration === 'default' || that.mediaConfiguration === 'Default') ? 'VP8' : that.mediaConfiguration,
                         },
                         audio: {
                             codec: 'OPUS',
                         },
                     },
                     selectedCam: stream.video.deviceId,
                     selectedMic: stream.audio.deviceId,
                     error: 'Invalid stream',
                     externalIp: that.externalIp,
                 };
                 that.createEventLog('clientStreamPublishFailed', additionalOptions);
             }
         }
         else {
             Logger.error('publish() invalid param - callback');
         }
     };
 
     const onRoomRecordStarted = (response) => {
         const connectEvt = RoomEvent({ type: 'room-record-on', message: { moderatorId: response.moderatorId } });
         that.dispatchEvent(connectEvt);
     };
 
     const onRoomRecordStopped = (response) => {
         const connectEvt = RoomEvent({ type: 'room-record-off', message: { moderatorId: response.moderatorId } });
         that.dispatchEvent(connectEvt);
     };
 
     const onRoomLiveRecordStarted = (response) => {
         const connectEvt = RoomEvent({ type: 'room-live-recording-on', message: { message: 'live recording is running' } });
         that.dispatchEvent(connectEvt);
     };
 
     const onRoomLiveRecordStopped = (response) => {
         const connectEvt = RoomEvent({ type: 'room-live-recording-off', message: { message: '' } });
         that.dispatchEvent(connectEvt);
     };
 
     const onRoomLiveRecordFailed = (response) => {
         const connectEvt = RoomEvent({ type: 'room-live-recording-failed', message: { error: response.error } });
         that.dispatchEvent(connectEvt);
     };
 
     const onChangeLayout = (response) => {
         const connectEvt = RoomEvent({ type: 'change-layout', message: { layout: response.layout } });
         that.dispatchEvent(connectEvt);
     };
 
     const onNewActiveTalker = (res) => {
         // safari is not sending REMB for  subscriber channels.. workaround - read stats and send to server
         if ((Connection.browserEngineCheck() === 'safari') && (that.sendRecvBitrateStats === false)) {
             sendSubscribersBitrate();
         }
         /*if(res.active === false){
             that.localStreams.forEach(function(value,key){
                 if(value.ifVideo() && !value.ifScreen()){
                     value.muteNonATPubVideo();
                 }
             });
         }else if(res.active === true){
             that.localStreams.forEach(function(value,key){
                 if(value.ifVideo() && !value.ifScreen()){
                     value.unmuteNonATPubVideo();
                 }
             });
         } */
         if (that.nonTalkerMediaParams && res.active != localMediaStreamInUse){
           let kbps, fps;
           if (res.active){ 
             if (localVideoStreamATStateBw == undefined) localVideoStreamATStateBw = spec.maxVideoBW;
             if (spec.minVideoBW != undefined ){
                kbps = {min: spec.minVideoBW, max: localVideoStreamATStateBw};
                fps = {max: spec.maxVideoFps};
             }
           } else {
               kbps = {min: that.nonTalkerMediaParams.video.bw, max: that.nonTalkerMediaParams.video.bw};
               fps =  {max:that.nonTalkerMediaParams.video.fps};
           }
           if (kbps != undefined){
             localMediaStreamInUse = res.active;
             that.localStreams.forEach(function(stream,key){
               if(stream.ifVideo() && !stream.ifScreen()&& !stream.ifCanvas()){
                 console.log ("onActiveList (): setting video param for AT: " + res.active +
                              " kbps: "  + kbps.max + " fps:" + fps.max);
                 stream.setVideoParamsRange(kbps.max, kbps.min, fps.max, undefined, true); 
               }
             });
           }
         }
         for (let list = 0; list < res.activeList.length; list++) {
           if (that.remoteStreams.getAll()[res.activeList[list].streamId]){
             if (res.activeList[list].mediatype === 'audio' && that.videoMutedUsers[res.activeList[list].clientId]) {
                 that.remoteStreams.getAll()[res.activeList[list].streamId].audioOnly = true;
                 Logger.info(`Recieved active talker list, videomuted: ${res.activeList[list].videomuted} reason: ${res.activeList[list].reason}`);
                 that.remoteStreams.getAll()[res.activeList[list].streamId].setVideoMutedMessage(res.activeList[list]);
                 delete that.videoMutedUsers[res.activeList[list].clientId];
             } else if (res.activeList[list].mediatype === 'audioOnly') {
                 that.remoteStreams.getAll()[res.activeList[list].streamId].audioOnly = true;
             }
             if (that.remoteStreams.getAll()[res.activeList[list].streamId].audioOnly && res.activeList[list].mediatype === 'audiovideo') {
                 delete that.remoteStreams.getAll()[res.activeList[list].streamId].audioOnly;
             }
             that.remoteStreams.getAll()[res.activeList[list].streamId].reloadPlayer(
                 res.activeList[list],
                 avOptions.subscribe.imageOnVideoMute,
             );
             const talkerEntry = that.activeTalkerList.get(res.activeList[list].streamId);
             if (talkerEntry && (talkerEntry.mediatype != res.activeList[list].mediatype)) {
                 switch (res.activeList[list].mediatype) {
                     case 'audiovideo':
                     case 'video':
                         that.remoteStreams.getAll()[res.activeList[list].streamId].setVideoMutedMessage(res.activeList[list]);
                         if (that.remoteStreams.getAll()[res.activeList[list].streamId].blankFrameSet) {
                             //that.remoteStreams.getAll()[res.activeList[list].streamId].muteSubscriberStreamVideo(false);
                             //that.remoteStreams.getAll()[res.activeList[list].streamId].setBlankFrameOnSubscriberVideoStream(false);
                             delete that.remoteStreams.getAll()[res.activeList[list].streamId].blankFrameSet;
                         }
                         break;
 
                     case 'audio':
                     case 'audioOnly':
                         that.remoteStreams.getAll()[res.activeList[list].streamId].setVideoMutedMessage(res.activeList[list]);
                         if (!that.remoteStreams.getAll()[res.activeList[list].streamId].blankFrameSet) {
                             //that.remoteStreams.getAll()[res.activeList[list].streamId].setBlankFrameOnSubscriberVideoStream(true);
                             //that.remoteStreams.getAll()[res.activeList[list].streamId].setBlankFrameOnSubscriberVideoStream(false);
                             //that.remoteStreams.getAll()[res.activeList[list].streamId].muteSubscriberStreamVideo(true);
                             that.remoteStreams.getAll()[res.activeList[list].streamId].blankFrameSet = true;
                         }
                         break;
 
                     default:
                         Logger.info('mediatype not handled entry:', JSON.stringify(res.activeList[list]));
                         break;
                 }
                 that.activeTalkerList.set(res.activeList[list].streamId, res.activeList[list]);
             } else if (!talkerEntry) {
                 that.activeTalkerList.set(res.activeList[list].streamId, res.activeList[list]);
             }
           }else {
             Logger.error ("onNewActiveTalker() remote stream undefined streamId: " + res.activeList[list].streamId);
           }
         }
         const evt = RoomEvent({ type: 'active-talkers-updated', message: { activeList: res.activeList, active: res.active } });
         that.dispatchEvent(evt);
         if (!that.allStreamsActive){
           that.allStreamsActive = true;
           if (that.streamsHealthTimerId == 0){
             if (mediaConnectionTimer != undefined){
               clearTimeout(mediaConnectionTimer);
               mediaConnectionTimer = undefined;
             }
             that.streamsHealthTimerId = setInterval(checkAndProcessStreamsHealth, 10000);
           }
         }
     };
 
     that.startRecord = (callback = () => { }) => {
         if (typeof (callback) === 'function') {
             that.startRecording(undefined, callback);
         } else {
             Logger.error('startRecord() invalid param - callback');
         }
     };
 
     that.stopRecord = (callback = () => { }) => {
         if (typeof (callback) === 'function') {
             that.stopRecording(undefined, callback);
         } else {
             Logger.error('stopRecord() invalid param - callback');
         }
     };
 
     // streaming
     const isValidUrl = (s) => {
         const regexp = /(http|https|rtmp|rtmps):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/;
         return regexp.test(s);
     };
 
     that.startStreaming = (streamingConfig, callback = () => { }) => {
         if (typeof callback === 'function' && typeof streamingConfig === 'object' && streamingConfig.hasOwnProperty('rtmpDetails')) {
             Logger.info('start streaming called');
             let allow = true;
 
             if (that.me.role !== 'moderator') {
                 allow = false;
                 Logger.info('user is trying to start streaming and he is not a moderator');
                 EL.error('room-event', customEvents.event_general_failed, { message: `startStreaming - ${customErrors.error_7008.desc}` });
                 callback(customErrors.error_7008);
                 return;
             }
 
 
             if (streamingConfig.rtmpDetails === undefined) {
                 EL.error('room-event', customEvents.event_general_failed, { message: `startStreaming - ${customErrors.error_7009.desc}` });
                 callback(customErrors.error_7009);
                 return;
             }
 
             if (streamingConfig.rtmpDetails.rtmpUrl !== undefined) {
                 let urlArray = streamingConfig.rtmpDetails.rtmpUrl.split(",");
                 if (urlArray.length > 3) {
                     callback(customErrors.error_7101);
                     return;
                 }
             }
 
             // to do validate the regex and confirm if rtmpdetails and urlDetails are configured properly
             if (!isValidUrl(streamingConfig.rtmpDetails.rtmpUrl)) {
                 Logger.info(' invalid rtmp or page input url');
                 allow = false;
                 EL.error('room-event', customEvents.event_general_failed, { message: `startStreaming - ${customErrors.error_7102.desc}` });
                 callback(customErrors.error_7102);
                 return;
             }
             //    streamingConfig.options = { confNum: '12345', roomId: '9876' };
             //    streamingConfig.rtmpDetails = { rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2/4rjb-hprf-7wf5-9923' };
             //    streamingConfig.urlDetails = { url: 'https://vc-manu.vcloudx.com:9074/room/?token=', layOut: {} };
             let result = {};
             if (that.state === DISCONNECTED /*&& validate the rtmp url details*/) {
                 result = customErrors.error_7103;
                 Logger.info(' room is disconnected');
                 callback(result);
                 return;
             }
             if (!(callback && typeof callback === 'function')) {
                 var callback = (res) => {
                     Logger.info('SDK defined callback streaming response ', res);
                 };
             }
             Logger.info('start streaming called with callback ');
             // fine send the start streaming signal
             //    let allow = (that.subscription && (that.subscription.recording === false)) ? false : true;
             if (allow) {
                 socket.sendMessage('startStreaming', streamingConfig, (result, error) => {
                     if (result === null) {
                         Logger.error('Error on start streaming', error);
                         if(error.result !== undefined){
                           callback(error);
                           return;
                         } else if(error.status !== undefined) {
                           //    EL.error('room-event', customEvents.event_stop_recording_failed, { error: error });
                           var response = {result: error.status.resultCode, error: 'streaming error', desc: error.status.error.errorDesc, status: error.status};
                           callback(response);
                           return;
                         }
                     } else {
                       var resp = {result: result.status.resultCode, error: '', desc: '', status: result.status};
                       callback(resp, error);
                     }
                 });
             } else {
                 callback(customErrors.error_7000);
             }
         } else {
             Logger.error('startStreaming() invalid param - streamingConfig/callback');
         }
     };
 
     that.stopStreaming = (param1, param2) => {
         let callback, options;
         if (param1 != undefined && typeof param1 === 'function') {
           callback = param1;
         } else if(param2 != undefined  && typeof param2 === 'function') {
           if (param1 != undefined){
             options = param1;
           }
           callback = param2;
         }
         if (typeof callback === 'function') {
             Logger.info('stop streaming called');
             if (that.me.role !== 'moderator') {
                 Logger.info('user is trying to stop streaming and he is not a moderator');
                 callback(customErrors.error_7044);
                 return;
             }
             var streamingConfig = {};
             streamingConfig.options = {
                 // @todo - should be part of the config
                 confNum: '12345',
                 roomId: '9876',
             };
             streamingConfig.rtmpDetails = {
                 // @todo - should be part of the config
                 rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2/4rjb-hprf-7wf5-9923',
             };
             streamingConfig.urlDetails = {
                 // @todo - should be part of the config
                 url: 'https://vc-manu.vcloudx.com:9074/room/?token=',
                 layOut: {},
             };
             let result = {};
             if (that.state === DISCONNECTED /*&& validate the rtmp url details*/) {
                 result = customErrors.error_7045;
                 Logger.info(' room is disconnected');
                 callback(result);
                 return;
             }
             if (!(callback && typeof callback === 'function')) {
                 callback = (res) => {
                     Logger.info('SDK defined callback streaming response ', res);
                 };
             }
             Logger.info('stop called with callback ');
             // fine send the stop streaming signal
             const allow = true;
             if (allow) {
                 socket.sendMessage('stopStreaming', streamingConfig, (result, error) => {
                     if (result === null) {
                         Logger.error('Error on stop streaming', error);
                         if(error.status !== undefined) {
                           var response = {result: error.status.resultCode, error: 'streaming error', desc: error.status.error.errorDesc, status: error.status};
                           callback(response);
                           return;
                         }
                     } else {
                       Logger.info('Stop streaming');
                       var resp = {result: result.status.resultCode, error: '', desc: '', status: result.status};
                       callback(resp, error);
                     }
                 });
             } else {
                 callback(customErrors.error_7000);
             }
         } else {
             Logger.error('stopStreaming() invalid param - streamingConfig/callback');
         }
     };
     that.setStreamingParams = function (config, callback) {
         Logger.info('set Streaming Params called');
         if (that.me.role !== 'moderator') {
             Logger.warning('User should be a moderator user to change Streaming params');
             callback(customErrors.error_7072);
             return;
         }
         let result = {};
         if (that.state === DISCONNECTED) {
             result = customErrors.error_7078;
             Logger.info(' room is disconnected');
             callback(result);
             return;
         }
         if (!(callback && typeof callback === 'function')) {
             var callback = (res) => { Logger.info('SDK defined callback Streaming params change response ', res); };
         }
         Logger.info('Streaming params change called with callback ');
         // fine send the Streaming params change signal
         const allow = true;
         if (allow) {
             socket.sendMessage('setStreamingParams', config, (result, error) => {
                 if (result === null) {
                     Logger.error('Error on Streaming param change: ', error);
                     EL.error('room-event', customEvents.event_streaming_param_change_failed, { error, message: error.status.error });
                     callback(error);
                     return;
                 }
                 Logger.info('Streaming param change Success');
                 EL.info('room-event', customEvents.event_streaming_param_change_success, { error: {} });
                 callback(result, error);
             });
         } else {
             customErrors.error_7072.desc = 'Streaming param change failed';
             callback(customErrors.error_7072);
         }
     };
     // end streaming
 
     // start Live Recording
     // Room API to start Live Recording, called as room.startLiveRecording(recordingConfig, callback)
     // recordingConfig : { urlDetails: {url: 'URL of view client ex: https://rtmp.enablex.io/?token=', layOut: {} } };
     that.startLiveRecording = function (recordingConfig, callback) {
         Logger.info('start Live Recording called');
         let allow = true;
 
         if (that.me.role !== 'moderator') {
             allow = false;
             Logger.warning('User should be a moderator to start live recording');
             callback(customErrors.error_7201);
             return;
         }
 
         // to do validate the regex and confirm if urlDetails are configured properly
         /*if (recordingConfig.urlDetails !== undefined && recordingConfig.urlDetails.url !== undefined && !isValidUrl(recordingConfig.urlDetails.url)) {
             Logger.info(' invalid page input url');
             allow = false;
             callback(customErrors.error_7202);
             return;
         }*/
         let result = {};
         if (that.state === DISCONNECTED) {
             result = customErrors.error_7203;
             Logger.info(' room is disconnected');
             callback(result);
             return;
         }
         if (!(callback && typeof callback === 'function')) {
             var callback = (res) => { Logger.info('SDK defined callback Live recording response ', res); };
         }
         Logger.info('start Live Recording called with callback ');
         // fine send the start live recording signal
         if (allow) {
             socket.sendMessage('startLiveRecording', recordingConfig, (result, error) => {
                 if (result === null) {
                     Logger.error('Error on start Live Recording', error);
                     EL.error('room-event', customEvents.event_start_live_recording_failed, { error, message: error.message});
                     if(error.status !== undefined) {
                       var response = {result: error.status.resultCode, error: 'live recording error', desc: error.status.error.errorDesc};
                       callback(response);
                       return;
                     }
                 }
                 if(result.status.resultCode === 7014){
                   roomRecordStatus = true; // Live Recording Failed, Fallback to legacy success
                 }
                 EL.info('room-event', customEvents.event_start_live_recording_success, { error: {} });
                 Logger.info('Start Live Recording Success');
                 var resp = {result: result.status.resultCode, error: '', desc: ''};
                 callback(resp, error);
             });
         } else {
             callback(customErrors.error_7204);
         }
     };
 
     that.stopLiveRecording = (callback = () => { }) => {
         Logger.info('stop Live Recording called');
         if (that.me.role !== 'moderator') {
             Logger.warning('User should be a moderator user to start live recording');
             callback(customErrors.error_7036);
             return;
         }
         var recordingConfig = {};
         recordingConfig.urlDetails = { url: '', layOut: {} };
         let result = {};
         if (that.state === DISCONNECTED) {
             result = customErrors.error_7037;
             Logger.info(' room is disconnected');
             callback(result);
             return;
         }
         if (!(callback && typeof callback === 'function')) {
             var callback = (res) => { Logger.info('SDK defined callback Live Recording response ', res); };
         }
         Logger.info('stop Live Recording called with callback ');
         // fine send the stop Live Recording signal
         const allow = true;
         if (allow) {
             socket.sendMessage('stopLiveRecording', recordingConfig, (result, error) => {
                 if (result === null) {
                     Logger.error('Error on stop stop live recording', error);
                     EL.error('room-event', customEvents.event_stop_live_recording_failed, { error, message: error.message });
                     if(error.status !== undefined) {
                       var response = {result: error.status.resultCode, error: 'live recording error', desc: error.status.error.errorDesc};
                       callback(response);
                       return;
                     }
                     return;
                 }
                 if(result.status.resultCode === 7034) {
                   roomRecordStatus = false;
                   result.status.resultCode = 0;
                 }
                 Logger.info('Stop Live Recording Success');
                 EL.info('room-event', customEvents.event_stop_live_recording_success, { error: {} });
                 var resp = {result: result.status.resultCode, error: '', desc: ''};
                 callback(resp, error);
             });
         } else {
             callback(customErrors.error_7204);
         }
     };
 
     that.setLiveRecordingParams = function (config, callback) {
         Logger.info('set Live Recording Params called');
         if (that.me.role !== 'moderator') {
             Logger.warning('User should be a moderator user to change live recording params');
             customErrors.error_7071.desc = 'Only moderator can change live recording params';
             callback(customErrors.error_7071);
             return;
         }
         let result = {};
         if (that.state === DISCONNECTED) {
             result = customErrors.error_7079;
             Logger.info(' room is disconnected');
             callback(result);
             return;
         }
         if (!(callback && typeof callback === 'function')) {
             var callback = (res) => { Logger.info('SDK defined callback Live Recording params change response ', res); };
         }
         Logger.info('Live Recording params change called with callback ');
         // fine send the Live Recording param change signal
         const allow = true;
         if (allow) {
             socket.sendMessage('setLiveRecordingParams', config, (result, error) => {
                 if (result === null) {
                     Logger.error('Error on live recording param change: ', error);
                     EL.error('room-event', customEvents.event_live_recording_param_change_failed, { error, message: error.status.error });
                     callback(error);
                     return;
                 }
                 Logger.info('Live Recording param change Success');
                 EL.info('room-event', customEvents.event_live_recording_param_change_success, { error: {} });
                 callback(result, error);
             });
         } else {
             customErrors.error_7071.desc = 'live recording param change failed';
             callback(customErrors.error_7071);
         }
     };
     // end Live Recording
 
     // API to invalidate Transcoding
     that.invalidateTranscoding = function (config, callback) {
         Logger.info('Invalidate Transcoding called');
         /*if (that.me.role !== 'moderator') {
           Logger.warning('User should be a moderator user to invalidate Transcoding');
           customErrors.error_7001.desc = 'Only moderator can invalidate Transcoding';
           callback(customErrors.error_7001);
           return;
           }*/
         let result = {};
         if (that.state === DISCONNECTED) {
             result = customErrors.error_8000;
             Logger.info(' room is disconnected');
             callback(result);
             return;
         }
         if (!(callback && typeof callback === 'function')) {
             var callback = (res) => { Logger.info('SDK defined callback Invalidate Transcoding response ', res); };
         }
         Logger.info('Invalidate Transcoding called with callback ');
         // fine send the Invalidate Transcoding signal
         const allow = true;
         if (allow) {
             socket.sendMessage('invalidateTranscoding', config, (result, error) => {
                 if (result === null) {
                     Logger.error('Error on Invalidate Transcoding', error);
                     callback(error);
                     return;
                 }
                 Logger.info('Invalidate Transcoding');
                 callback(result, error);
             });
         } else {
             callback(customErrors.error_8000);
         }
     };
     // end Invalidate Transcoding
 
     //request floor (old chairControl)
     that.requestFloor = (callback = () => { }) => {
         if (typeof callback === 'function') {
             processFloorRequest(that.clientId, 'requestFloor', (result, error) => {
                 callback(result, error);
                 if (result !== undefined) {
                     that.cCrequest = that.cCrequest.filter(req => req.clientId !== options);
                 }
             });
         }
         else {
             Logger.error('requestFloor() invalid param - callback');
         }
     };
 
     that.cancelFloor = (callback = () => { }) => {
         if (typeof callback === 'function') {
             processFloorRequest(that.clientId, 'cancelFloor', (result, error) => {
                 callback(result, error);
                 if (result !== null) {
                     that.cCrequest = that.cCrequest.filter(req => req.clientId !== options);
                 }
             });
         }
         else {
             Logger.error('cancelFloor() invalid param - callback');
         }
     };
 
     that.finishFloor = (callback = () => { }) => {
         if (typeof callback === 'function') {
             processFloorRequest(that.clientId, 'finishFloor', (result, error) => {
                 localStreams.forEach((stream, id) => {
                     Logger.info(`finishFloor: unpulish ${stream.getID()}::::${id}`);
                     that.unpublish(stream, (arg) => { });
                 });
                 that.floorGranted = false;
                 callback(result, error);
             });
         }
         else {
             Logger.error('finishFloor() invalid param - callback');
         }
     };
 
     //grant floor (grantFloor,relaseFloor,denyFloor)
     that.grantFloor = (options, callback = () => { }) => {
         if (typeof callback === 'function') {
             processFloorRequest(options, 'grantFloor', (result, error) => {
                 if (result !== null) {
                   that.cCrequest = that.cCrequest.filter(req => req.clientId !== options);
                   that.cCapprovedHands.push({clientId: options, moderatorId: that.clientId});
                 }
                 callback(result, error);
             });
         }
         else {
             Logger.error('grantFloor() invalid param - callback');
         }
     };
 
     //---
     that.denyFloor = (options, callback = () => { }) => {
         if (typeof callback === 'function') {
             processFloorRequest(options, 'denyFloor', (result, error) => {
                 callback(result, error);
                 if (result !== null) {
                     that.cCrequest = that.cCrequest.filter(req => req.clientId !== options);
                 }
             });
         }
         else {
             Logger.error('denyFloor() invalid param - callback');
         }
     };
     //---
 
     that.relaseFloor = (options, callback = () => { }) => {
       that.releaseFloor(options,callback);
     };
     that.releaseFloor = (options, callback = () => { }) => {
         if (typeof callback === 'function') {
             processFloorRequest(options, 'releaseFloor', (result, error) => {
                 if (result !== null) {
                   that.cCrequest = that.cCrequest.filter(req => req.clientId !== options);
                   checkAndRemoveGrantedFloor(options);
                 }
                 callback(result, error);
             });
         }
         else {
             Logger.error('releaseFloor() invalid param - callback');
         }
     };
 
     that.inviteToFloor = (client_id, callback = () => { }) => {
         let data = { clientId: client_id };
         that.socket.sendMessage('inviteToFloor', data, function (response) {
             if (response.result === 0) {
                 that.cCrequest.push({ clientId: data.clientId, name: that.userList.get(client_id).name, type: "requested" });
             }
             callback(response);
         });
     };
 
 
     that.acceptInviteFloorRequest = (callback = () => { }) => {
         processFloorRequest(that.clientId, 'acceptFloor', (result, error) => {
             callback(result, error);
             if (result !== undefined) {
                 that.cCrequest = that.cCrequest.filter(req => req.clientId !== options);
             }
         });
     };
 
     that.rejectInviteFloor = (callback = () => { }) => {
         processFloorRequest(that.clientId, 'rejectFloor', (result, error) => {
             that.floorInvited = false;
             callback(result, error);
             if (result !== undefined) {
                 that.cCrequest = that.cCrequest.filter(req => req.clientId !== options);
             }
         });
     };
 
 
     that.cancelFloorInvite = (id, callback = () => { }) => {
         processFloorRequest(id, 'cancelFloorInvite', (result, error) => {
             callback(result, error);
             if (result !== undefined) {
                 that.cCrequest = that.cCrequest.filter(req => req.clientId !== options);
             }
         });
     };
 
 
     //chairControl mute all
     that.chairControlMuteAll = (callback = () => { }) => {
         that.socket.sendEvent('room-muted', (result, error) => {
             if (result === null) {
                 Logger.error('Error on floor request', error);
                 callback(undefined, error);
                 // return;
             } else {
                 callback(result);
             }
         });
     };
 
     //chairControl un-mute all
     that.chairControlUnMuteAll = (callback = () => { }) => {
         that.socket.sendEvent('room-unmuted', (result, error) => {
             if (result === null) {
                 Logger.error('Error on floor request', error);
                 callback(undefined, error);
             } else {
                 callback(result);
             }
         });
     };
 
     //chairControl mute single client (old chairControlMuteOne)
     that.muteOne = (clientId, callback = () => { }) => {
         that.socket.sendParamEvent('muteUser', clientId, (result, error) => {
             if (result === null) {
                 Logger.error('Error on floor request', error);
                 callback(undefined, error);
             } else {
                 callback(result);
             }
         });
     };
 
     //chairControl un-mute single client
     that.unMuteOne = (clientId, callback = () => { }) => {
         that.socket.sendParamEvent('unMuteUser', clientId, (result, error) => {
             if (result === null) {
                 Logger.error('Error on floor request', error);
                 callback(undefined, error);
                 return;
             }
             callback(result);
         });
     };
 
     that.muteRoom = (data, callback = () => { }) => {
         if (typeof callback === 'function') {
             if (data === undefined || (data.audio === undefined && data.video === undefined)) {
                 callback(customErrors.error_1155);
                 return;
             }
             if (data.video === false && data.audio === false) {
                 Logger.error('at least one of the constraints should be false');
                 callback(customErrors.error_1155);
                 return;
             }
             localStreams.forEach((stream, id) => {
                 if (!stream.screen && !stream.canvas) {
                     if (data.audio === true && stream.ifAudio() && !stream.selfMuteAudio) {
                         stream.muteAudio((response) => {
                             Logger.info('Mute Audio for the call');
                         }, true, 0, false, true);
                     }
                     //Mute the existing video, if the video is requested for breakout room.
                     if (stream.ifVideo() && data.video === true && !stream.selfMuteVideo) {
                         stream.muteVideo((response) => {
                             Logger.info('Mute Video for the call');
                         }, true, 0, false, false, true);
                     }
                 }
             });
 
             that.socket.sendMessage('muteRoom', data, (result, error) => {
                 if (result === null) {
                     Logger.error('Error on mute room request', error);
                     EL.error('room-event', customEvents.event_room_mute_failed, { message: ('mute room request failed') });
                     callback(undefined, error);
                     return;
                 }
                 that.roomMuted = true;
                 EL.info('room-event', customEvents.event_room_mute_success, { message: ('mute room request succeeded') });
                 callback(result);
             });
         } else {
             Logger.error('muteRoom() invalid param - callback');
         }
     };
 
     that.unMuteRoom = (data, callback = () => { }) => {
         if (typeof callback === 'function') {
             if (data === undefined || (data.audio === undefined && data.video === undefined)) {
                 callback(customErrors.error_1155);
                 return;
             }
             if (data.video != false && data.audio != false) {
                 Logger.error('at least one of the constraints should be false');
                 callback(customErrors.error_1155);
                 return;
             }
             localStreams.forEach((stream, id) => {
                 if (!stream.screen && !stream.canvas) {
                     Logger.info(`SelfMuteAudio: ${stream.selfMuteAudio} hardMutedAudio: ${stream.hardAudioMuted}`);
                     if (!data.audio && stream.ifAudio() && !stream.hardAudioMuted) {
                         stream.unmuteAudio((response) => {
                             Logger.info('UnMute Audio for the call');
                         }, true, 0, false, true);
                     }
                     //Mute the existing video, if the video is requested for breakout room.
                     Logger.info(`SelfMuteVideo: ${stream.selfMuteVideo} hardMutedVideo: ${stream.hardVideoMuted}`);
                     if (!data.video && stream.ifVideo() && !stream.hardVideoMuted) {
                         stream.unmuteVideo((response) => {
                             Logger.info('UnMute Video for the call');
                         }, true, 0, false, true);
                     }
                 }
             });
 
             that.socket.sendMessage('unMuteRoom', data, (result, error) => {
                 if (result === null) {
                     Logger.error('Error on mute room request', error);
                     EL.error('room-event', customEvents.event_room_unmute_failed, { message: ('unmute room request failed') });
                     callback(undefined, error);
                 } else {
                     that.roomMuted = false;
                     EL.info('room-event', customEvents.event_room_unmute_success, { message: ('unmute room request succeeded') });
                     callback(result);
                 }
             });
         } else {
             Logger.error('unMuteRoom() invalid param - callback');
         }
     };
 
     that.pauseRoom = (callback = () => { }) => {
         if (typeof (callback) === 'function') {
             Logger.info('Pausing the room');
             const data = { audio: true, video: true };
             that.muteRoom(data, (response) => {
                 callback(response);
             });
         } else {
             Logger.error('pauseRoom() invalid param - callback');
         }
     };
 
     that.resumeRoom = (callback = () => { }) => {
         if (typeof (callback) === 'function') {
             Logger.info('Resuming the room');
             const data = { audio: false, video: false };
             that.unMuteRoom(data, (response) => {
                 callback(response);
             });
         } else {
             Logger.error('resumeRoom() invalid param - callback');
         }
     };
 
     //Switch room_mode
     that.switchRoomMode = (roomMode, callback = () => { }) => {
         that.socket.sendParamEvent('switchRoomMode', roomMode, (result, error) => {
             if (result === null) {
                 Logger.error('Error on floor request', error);
                 callback(undefined, error);
             } else {
                 callback(result);
             }
         });
     };
 
     // Returns callback(id, error)
     that.startRecording = (stream, callback = () => { }) => {
         Logger.debug('Trying to start recording...');
         let streamId;
         const allow = !((that.subscription && (that.subscription.recording === false)));
         if (allow && ((stream && stream.local === false) || !stream)) {
             if (stream) {
                 streamId = stream.getID();
             }
             socket.sendMessage('startRecord', { to: streamId }, (success, error) => {
                 if (success === null) {
                     Logger.error('Error on start recording', error);
                     EL.error('room-event', customEvents.event_start_recording_failed, { error, message: error.msg });
                     callback(error);
                     const additionalOptions = {
                         error,
                         externalIp: that.externalIp,
                     };
                     that.createEventLog('roomRecordingFailed', additionalOptions);
                     return;
                 }
                 Logger.info('Started recording');
                 EL.info('room-event', customEvents.event_start_recording_success, { error: {} });
                 if (success.result === 0) {
                     roomRecordStatus = true;
                 }
                 callback(success, error);
                 const additionalOptions = {
                     externalIp: that.externalIp,
                 };
                 that.createEventLog('roomRecordingSuccess', additionalOptions);
             });
         } else if (!allow) {
             EL.info('room-event', customEvents.event_start_recording_failed, { message: customErrors.error_1170.desc });
             callback(customErrors.error_1170);
         }
     };
 
     that.mediaDeviceError = (error) => {
       //since its media device error, it required to reconnect and try
       console.log ("mediaDeviceError() errr: " + JSON.stringify(error) + "reconencting");
       that.socket.disconnect();
     }
     // reconnection case - manage recording status
     that.manageRecordingStatus = (recordStatus) => {
         Logger.info('reconnected manage recording status ', recordStatus);
         if (that.me.role === 'moderator' && roomRecordStatus == true && that.reconnectAttempt > 0 && that.reconnectionAllowed === true) {
             Logger.info('room recording was enabled before reconnect');
             that.startRecord((success, error) => {
                 if (success !== null) {
                     Logger.info('reconnected manage recording success ');
                     EL.info('room-event', customEvents.event_start_recording_success, { message: 'reconnected manage recording success' });
                 } else {
                     Logger.info('Failed to restart recording after reconnection.');
                     EL.error('room-event', customEvents.event_start_recording_failed, { message: 'Failed to restart recording after reconnection.' });
                 }
             });
         } else {
             Logger.info('reenbling recording for this role is not allowed ', that.me.role);
             EL.info('room-event', customEvents.event_start_recording_failed, { message: `reenbling recording for role ${that.me.role} is not allowed` });
         }
     };
 
     // Returns callback(id, error)
     that.stopRecording = (recordingId, callback = () => { }) => {
         const allow = !((that.subscription && (that.subscription.recording === false)));
         if (allow) {
             socket.sendMessage('stopRecord', { id: recordingId }, (result, error) => {
                 if (result === null) {
                     Logger.error('Error on stop recording', error);
                     EL.error('room-event', customEvents.event_stop_recording_failed, { error });
                     callback(error);
                     return;
                 }
                 roomRecordStatus = false;
                 Logger.info('Stop recording', recordingId);
                 EL.info('room-event', customEvents.event_stop_recording_success, { error: {} });
                 callback(result, error);
                 const additionalOptions = {
                     externalIp: that.externalIp,
                 };
                 that.createEventLog('roomRecordingStopped', additionalOptions);
             });
         } else {
             EL.info('room-event', customEvents.event_stop_recording_failed, { message: customErrors.error_1170.desc });
             callback(customErrors.error_1170);
         }
     };
     const discardLocalStreamForReconnect = (screen, canvas) => {
         let prevStreams = [];
         that.localStreamsBeforeReconnect.forEach((localStream, id) => {
           if ((localStream.canvas && canvas) ||(localStream.screen && screen) ||
             (!localStream.canvas && !canvas && !localStream.screen && !screen))
             prevStreams.push(localStream);
         });
         for (let index = 0; index < prevStreams.length; index++) {
           that.localStreamsBeforeReconnect.remove(prevStreams[index].getID());
         }
     }
 
     const storeLocalStreamForReconnect = (stream2Add ) => {
       console.log ("Inside storeLocalStreamForReconnect() reconnect: " + stream2Add.reconnect + " that.reconnectionState: " + 
                     that.reconnectionState + " that.reconnectionAllowed: " + that.reconnectionAllowed + 
                     " streamId: " + stream2Add.getID() + " canvas: " + stream2Add.canvas + " screen: " + stream2Add.screen);
       if (stream2Add.reconnect || that.reconnectionState || that.reconnectionAllowed){
         discardLocalStreamForReconnect(stream2Add.screen, stream2Add.canvas);
         that.localStreamsBeforeReconnect.add(stream2Add.getID(), stream2Add);
         return true;
       }
       return false;
     }
     // It unpublishes the local stream in the room, dispatching a StreamEvent("stream-removed")
     that.unpublish = (streamInput, callback = () => { }) => {
         if (typeof callback === 'function') {
             const stream = streamInput;
             // Unpublish stream from Client-Controller
             if (stream && stream.local) {
                 // Media stream
 
                 socket.sendMessage('unpublish', stream.getID(), (result, error) => {
                     if (result === null) {
                         Logger.error('Error unpublishing stream', error);
                         EL.error('room-event', customEvents.event_stream_unpublish_failed, { error });
                         callback(undefined, error);
                         return;
                     }
 
                     delete stream.failed;
                     EL.error('room-event', customEvents.event_stream_unpublish_success, { error: {} });
                     Logger.info('Stream unpublished');
                     callback(true);
                 });
                 stream.room = undefined;
 
                 const streamTobeDeleted = localStreams.get(stream.getID());
                 if (streamTobeDeleted !== undefined) {
                     //if its hardmuted while unpublishing, unmute the same. It will get hardmuted when next publish happens
                   if (streamTobeDeleted.hardVideoMuted){
                     streamTobeDeleted.unmuteVideo((resp) => { Logger.info('videoHardUnmuteCallback: ' + JSON.stringify(resp));},
                                                   false, 0, false);
                   }
                   if (streamTobeDeleted.hardAudioMuted){
                     streamTobeDeleted.unmuteAudio((resp) => { Logger.info('audioHardUnmuteCallback: '+ JSON.stringify(resp)); },
                                                   false, 0, false);
                   }
                     streamTobeDeleted.pc.close();
                     streamTobeDeleted.pc = null;
                     // populate the streams for reconnection
                     if (streamTobeDeleted.reconnect)
                       storeLocalStreamForReconnect(streamTobeDeleted);
                 }
 
                 localStreams.remove(stream.getID());
                 //stream.getID = () => { };
                 stream.setID (0);
                 stream.off('internal-send-data', sendDataSocketFromStreamEvent);
                 stream.off('internal-set-attributes', updateAttributesFromStreamEvent);
             } else {
                 const error = 'Cannot unpublish, stream does not exist or is not local';
                 EL.info('room-event', customEvents.event_stream_unpublish_failed, { error });
                 Logger.error(error);
                 callback(undefined, error);
             }
         }
         else {
             Logger.error('unpublish() invalid param - callback');
         }
     };
 
     that.sendControlMessage = (stream, type, action) => {
         if (stream && stream.getID()) {
             const msg = { type: 'control', action };
             socket.sendSDP('signaling_message', { streamId: stream.getID(), msg });
         }
     };
 
     // It subscribe to a remote stream and draws it inside the HTML tag given by the ID='elementID'
     that.subscribe = (streamInput, optionsInput = {}, callback = () => { }) => {
         const stream = streamInput;
         const options = JSON.parse(JSON.stringify(optionsInput));
         Logger.info("room.subscribe streamId: " + stream.getID() + " options: " + JSON.stringify(options));
         if (stream && !stream.local && !stream.failed) {
             if (stream.ifMedia()) {
                 // 1- Subscribe to Stream
                 if (!stream.ifVideo() && !stream.ifScreen()) {
                     options.video = false;
                 }
                 if (!stream.ifAudio()) {
                     options.audio = false;
                 }
 
                 if (stream.ifCanvas()) {
                     options.data = false;
                 }
 
                 if (!stream.ifCanvas()) {
                     options.canvas = false;
                 }
                 if ((that.mediaConfiguration !== VcxEvent.constant.H264_CODEC) && (config.browser_info.name === 'safari') && config.browser_info.version <= VcxEvent.constant.SAFARI_VERSION_NOT_SUPPORTING_VP8) {
                     options.video = false;
                     Logger.info('Stream for subscribe in room.subscribe:- SAFARI - false');
                 } else if ((that.mediaConfiguration !== VcxEvent.constant.H264_CODEC) && (config.browser_info.name === 'safari') && config.browser_info.version >= VcxEvent.constant.SAFARI_VERSION_SUPPORTING_VP8) {
                     options.video = true;
                     Logger.info('Stream publish in Init publish:- SAFARI - true');
                 }
                 Logger.info(`Stream for subscribe in room.subscribe:- options:: ${JSON.stringify(options)}`);
 
                 options.muteStream = {
                     audio: stream.ifCanvas() ? true : stream.audioMuted != undefined ? stream.audioMuted : false,
                     video: stream.videoMuted,
                 };
                 Logger.info('Stream for subscribe options ::: ', JSON.stringify(options));
 
                 if (that.reconnectionState === false) {
                     avOptions.subscribe.forceTurn = options.forceTurn ? options.forceTurn : false;
                     avOptions.subscribe.imageOnVideoMute = options.imageOnVideoMute ? options.imageOnVideoMute : false;
                 } else {
                     options.forceTurn = avOptions.subscribe.forceTurn;
                 }
                 Logger.debug(` Subscribe forceTurn: ( ${options.forceTurn},${avOptions.subscribe.forceTurn} ) reconnect state: ${that.reconnectionState}`);
                 stream.forceTurn = options.forceTurn;
                 stream.userRequestOptions = JSON.parse(JSON.stringify(optionsInput));
                 subscribeVcxRtc(stream, options, callback);
             } else if (stream.ifData() && options.data !== false) {
                 subscribeData(stream, options, callback);
             } else {
                 Logger.warning('There\'s nothing to subscribe to');
                 callback(undefined, 'Nothing to subscribe to');
                 return;
             }
             // Subscribe to stream stream
             Logger.info(`Subscribing to: ${stream.getID()}`);
             EL.info('room-event', customEvents.event_stream_subscribe_success, { message: `Subscribing to: ${stream.getID()}` });
             if (mediaConnectionTimer != undefined ) clearTimeout(mediaConnectionTimer);
             mediaConnectionTimer = setTimeout(mediaConnectionTimeout, 30000);
         } else {
             let error = 'Error on subscribe';
             if (!stream) {
                 Logger.warning('Cannot subscribe to invalid stream');
                 error = 'Invalid or undefined stream';
                 EL.error('room-event', customEvents.event_stream_subscribe_failed, { error });
             } else if (stream.local) {
                 Logger.warning('Cannot subscribe to local stream, you should subscribe to the remote version of your local stream');
                 error = 'Local copy of stream';
                 EL.error('room-event', customEvents.event_stream_subscribe_failed, { error, stream });
             } else if (stream.failed) {
                 Logger.warning('Cannot subscribe to failed stream.');
                 error = 'Failed stream';
                 EL.error('room-event', customEvents.event_stream_subscribe_failed, { error, stream });
             }
             callback(undefined, error);
 
             const additionalOptions = {
                 streamType: stream.ifScreen() ? 'share' : 'main',
                 streamId: stream.getID(),
                 selectedCandidates: {
                     local: '',
                     remote: '',
                 },
                 negotiatedCodecs: {
                     video: { codec: (that.mediaConfiguration === 'default' || that.mediaConfiguration === 'Default') ? 'VP8' : that.mediaConfiguration },
                     audio: { codec: 'OPUS' },
                 },
                 error,
                 externalIp: that.externalIp,
             };
             that.createEventLog('clientStreamSubscribeFailed', additionalOptions);
         }
     };
 
     // It unsubscribes from the stream, removing the HTML element.
     that.unsubscribe = (streamInput, callback = () => { }) => {
         const stream = streamInput;
         // Unsubscribe from stream stream
         if (socket !== undefined) {
             if (stream && !stream.local) {
               if (stream.reconnect){
                 console.log (" in that.unsubscribe() remove stream");
                 removeStream(stream);
                 delete stream.failed;
                 callback(customErrors.error_000);
               }else {
                 socket.sendMessage('unsubscribe', stream.getID(), (result, error) => {
                     if (result === null) {
                         callback(customErrors.error_1167);
                         return;
                     }
                     removeStream(stream);
                     delete stream.failed;
                     EL.error('room-event', customEvents.event_stream_unsubscribe_success, { message: 'Unsubscribe from stream - success' });
                     callback(customErrors.error_000);
                 }, () => {
                     Logger.error('Error calling unsubscribe.');
                     EL.error('room-event', customEvents.event_stream_unsubscribe_failed, { stream });
                 });
               }
             }else {
               callback(customErrors.error_1156);
             }
         }else {
           callback(customErrors.error_1163);
         }
     };
 
     that.hardMute = (callback = () => { }) => {
         if (typeof callback === 'function') {
             sendRemoteMediaDeviceControlRequest('room-muted', true, false, true, undefined, callback);
         } else {
             Logger.error('hardMute() invalid param - callback');
         }
     };
 
     that.hardUnmute = (callback = () => { }) => {
         if (typeof callback === 'function') {
             sendRemoteMediaDeviceControlRequest('room-unmuted', true, false, true, undefined, callback);
         } else {
             Logger.error('hardUnmute() invalid param - callback');
         }
     };
 
     that.hardMuteUserAudio = (clientId, callback = () => { }) => {
         if (typeof callback === 'function') {
             sendRemoteMediaDeviceControlRequest('hardmute-user-audio', true, false, false, clientId, callback);
         } else {
             Logger.error('hardMuteUserAudio() invalid param - callback');
         }
     };
 
     that.hardUnmuteUserAudio = (clientId, callback = () => { }) => {
         if (typeof callback === 'function') {
             sendRemoteMediaDeviceControlRequest('hardunmute-user-audio', true, false, false, clientId, callback);
         } else {
             Logger.error('hardUnmuteUserAudio() invalid param - callback');
         }
     };
 
     that.hardMuteUserVideo = (clientId, callback = () => { }) => {
         if (typeof callback === 'function') {
             sendRemoteMediaDeviceControlRequest('hardmute-user-video', false, true, false, clientId, callback);
         } else {
             Logger.error('hardMuteUserVideo() invalid param - callback');
         }
     };
 
     that.hardUnmuteUserVideo = (clientId, callback = () => { }) => {
         if (typeof callback === 'function') {
             sendRemoteMediaDeviceControlRequest('hardunmute-user-video', false, true, false, clientId, callback);
         } else {
             Logger.error('hardUnmuteUserVideo() invalid param - callback');
         }
     };
 
     that.subscriberVideoMute = (streamId, callback) => {
         that.socket.emitEvent(VcxEvent.RoomEvent.subscriber_video_mute, { streamId }, (result) => {
             if (result.result == 0) { callback(result); }
         });
     };
 
     that.setTalkerCount = (numTalker, callback = () => { }) => {
         if (typeof callback === 'function') {
             if (typeof numTalker != 'undefined' && typeof numTalker === 'number' && numTalker >= 0 && numTalker === parseInt(numTalker)) {
                 prefNumTakler = numTalker;
                 const numAudio = numTalker <= 3 ? 3 : numTalker;
                 const numVideo = that.audioOnlyMode ? 0 : numTalker;
                 const talkerInfo = { numTalkers: numTalker, numAudioTalkers: numAudio, numVideoTalkers: numVideo };
                 that.socket.emitEvent(VcxEvent.RoomEvent.set_active_talker, talkerInfo, (result) => {
                     if (result.result == 0) {
                         that.userAudioTalkerCount = result.numAudioTalkers;
                         if (that.audioOnlyMode === false) { that.userVideoTalkerCount = result.numVideoTalkers; }
                     }
                     callback(result);
                 });
             } else {
                 callback(customErrors.error_1155);
             }
         }
         else {
             Logger.error('setTalkerCount() invalid param - callback');
         }
     };
 
     that.getTalkerCount = (callback) => {
         if (typeof callback === 'function') {
             that.socket.sendEvent(VcxEvent.RoomEvent.get_active_talker, (result) => {
                 callback(result);
             });
         }
         else {
             Logger.error('getTalkerCount() invalid param - callback');
         }
     };
 
     that.getMaxTalkers = (callback) => {
         if (typeof callback === 'function') {
             that.socket.sendEvent(VcxEvent.RoomEvent.get_active_max_talker, (result) => {
                 callback(result);
             });
         }
         else {
             Logger.error('getMaxTalkers() invalid param - callback');
         }
     };
 
     that.setAdvancedOptions = (options, callback) => {
         if (options && options.length) {
             that.socket.emitEvent(VcxEvent.RoomEvent.set_adavanced_options, options, (result) => {
                 callback(result);
             });
         } else {
             callback(customErrors.error_1155);
         }
     };
 
     that.getAdvancedOptions = (callback) => {
         that.socket.sendEvent(VcxEvent.RoomEvent.get_adavanced_options, (result) => {
             callback(result);
         });
     };
 
     that.switchUserRole = (newModeratorId, callback = () => { }) => {
         if (typeof (callback) === 'function') {
             if ((that.me.role === 'moderator') && newModeratorId && that.clientId && (newModeratorId != that.clientId)) {
                 that.socket.emitEvent(VcxEvent.RoomEvent.switch_user_role, newModeratorId, (result) => {
                     callback(result);
                 });
             } else {
                 const error = (that.me.role !== 'moderator') ? customErrors.error_1168 : 
                               !that.clientId ? customErrors.error_1171 : customErrors.error_1155;
                 callback(error);
             }
         } else {
             Logger.error('switchUserRole() invalid param - callback');
         }
     };
 
     that.switchSpeaker = (speakerId, callback = () => { }) => {
         if (typeof callback === 'function') {
             if (speakerId != undefined && (that.selectedSpeakerId == undefined || speakerId != that.selectedSpeakerId) &&
                 (callback == undefined || typeof callback === 'function') &&
                 (Connection.browserEngineCheck() !== 'safari')) {
                 validSpeakerDevice(speakerId, (valid) => {
                     if (valid) {
                         remoteStreams.forEach((stream) => {
                             stream.setSpeaker(speakerId);
                         });
                         that.selectedSpeakerId = speakerId;
                         callback(customErrors.error_000);
                     } else {
                         callback(customErrors.error_1142);
                     }
                 });
             } else if (typeof callback === 'function') {
                 callback(Connection.browserEngineCheck() === 'safari' ? customErrors.error_1153 : speakerId == undefined ? customErrors.error_1155 : customErrors.error_1177);
             }
         }
         else {
             Logger.error('switchSpeaker() invalid param - callback');
         }
     };
 
     that.startLocalRecord = (type = 'remote', timeoutSecs = 10, callback) => {
         if (localRecord === 'none') {
             const promises = [];
             let index = 0;
             if ((type === 'remote') || (type === 'all')) {
                 remoteStreams.forEach((stream) => {
                     promises[index] = new Promise((resolve, reject) => {
                         stream.startLocalRecord(respCallback = (status) => {
                             resolve({ id: stream.getID(), status });
                         });
                     });
                     index++;
                 });
                 localRecord = type;
             }
 
             if ((type === 'local') || (type === 'all')) {
                 localStreams.forEach((stream) => {
                     promises[index] = new Promise((resolve, reject) => {
                         stream.startLocalRecord(respCallback = (status) => {
                             resolve({ id: stream.getID(), status });
                         });
                     });
                     index++;
                 });
                 localRecord = type;
             }
 
             if (localRecord !== 'none') {
                 if (timeoutSecs !== 0) {
                     promises[index] = new Promise((resolve, reject) => {
                         setTimeout(() => {
                             that.stopLocalRecord(respCallback = (status, info) => {
                                 resolve(info);
                             });
                         }, timeoutSecs * 1000);
                     });
                 }
                 Promise.all(promises).then((values) => {
                     if (callback) {
                         EL.info('room-event', customEvents.event_start_recording_success, { error: {} });
                         callback(customErrors.error_000, values);
                     }
                 });
             } else {
                 Logger.error('invalid param type');
                 EL.info('room-event', customEvents.event_start_recording_failed, { error: 'invalid param type' });
                 if (callback) callback(customErrors.error_1155);
             }
         } else {
             Logger.error('recording already in progress');
             EL.info('room-event', customEvents.event_start_recording_failed, { error: 'recording already in progress' });
             if (callback) {
                 callback(customErrors.error_1174);
             }
         }
     };
 
     that.stopLocalRecord = (callback) => {
         if (localRecord !== 'none') {
             const promises = [];
             let index = 0;
             if ((localRecord === 'remote') || (localRecord === 'all')) {
                 remoteStreams.forEach((stream) => {
                     promises[index] = new Promise((resolve, reject) => {
                         stream.stopLocalRecord(respCallback = (status) => {
                             resolve({ id: stream.getID(), status });
                         });
                     });
                     index++;
                 });
             }
             if ((localRecord === 'local') || (localRecord === 'all')) {
                 localStreams.forEach((stream) => {
                     promises[index] = new Promise((resolve, reject) => {
                         stream.stopLocalRecord(respCallback = (status) => {
                             resolve({ id: stream.getID(), status });
                         });
                     });
                     index++;
                 });
             }
             localRecord = 'none';
             EL.error('room-event', customEvents.event_stop_recording_success, { error: {} });
         } else {
             Logger.error('recoding not stopped');
             EL.info('room-event', customEvents.event_stop_recording_failed, { message: customErrors.error_1175.desc });
             if (callback) {
                 callback(customErrors.error_1175);
             }
         }
     };
 
     that.setReceiveVideoQuality = (opts, callback) => {
         const isObject = (obj) => {
             return Object.prototype.toString.call(obj) === '[object Object]';
         };
         if (isObject(opts) && typeof callback === "function") {
             const config = {};
             const video = {};
             let res = {};
             let videoQuality = opts.videoQuality;
             let streamType = opts.streamType;
             if (videoQuality === undefined) {
                 videoQuality = 'Auto';
             }
             if (streamType === undefined) {
                 streamType = 'talker';
             }
             Logger.info(`Dumping opts in setReceiveVideoQuality${JSON.stringify(opts)} streamType${streamType}`);
             if ((streamType != 'talker') && (streamType != 'canvas')) {
                 Logger.info(`setReceiveVideoQuality Failed Invalid Param -StreamType: ${streamType}`);
                 callback(customErrors.error_1155);
                 return;
             }
             switch (videoQuality) {
                 case 'HD':
                     video.width = 1280;
                     video.height = 720;
                     break;
 
                 case 'SD':
                     video.width = 960;
                     video.height = 540;
                     break;
 
                 case 'LD':
                     video.width = 640;
                     video.height = 360;
                     break;
 
                 case 'Auto':
                     // leave width and height undefined
                     break;
 
                 default:
                     Logger.info(`setReceiveVideoQuality for ${streamType}. Failed Invalid Param -videoQuality: ${videoQuality}`);
                     callback(customErrors.error_1155);
                     return;
             }
             video.frameRate = 30;
             config.video = video;
             if (((streamType == 'talker') && (that.receiveVideoQuality.get('talker') !== videoQuality)) ||
                 ((streamType == 'canvas') && (that.receiveVideoQuality.get('canvas') !== videoQuality))) {
                 remoteStreams.forEach((stream) => {
                     if ((streamType === 'talker') && (stream.canvas === false) && (stream.screen === false)) {
                         stream.updateConfiguration(config, (result) => {
                             Logger.info(`stream.updateConfiguration for talker stream result : ${result}`);
                         });
                     } else if ((streamType === 'canvas') && (stream.canvas === true)) {
                         stream.updateConfiguration(config, (result) => {
                             Logger.info(`stream.updateConfiguration for canvas stream result : ${result}`);
                         });
                     }
                 });
                 that.receiveVideoQuality.set(streamType, videoQuality);
             }
             res = { result: 0, msg: 'Video quality successfully updated.' };
             callback(res);
         }
         else {
             if (typeof callback !== 'function') {
                 Logger.error('setReceiveVideoQuality() invalid param - callback() ');
             }
             else {
                 Logger.error('setReceiveVideoQuality() invalid param - QualityOpt ');
                 callback(customErrors.error_1155);
                 return;
             }
         }
     };
 
 
     /**
      * Function to Get Receive Video Quality
      */
     that.getReceiveVideoQuality = (streamType) => {
         let res = {};
         if ((streamType === 'talker') || (streamType === 'canvas')) {
             const quality = that.receiveVideoQuality.get(streamType);
             res = {
                 result: 0,
                 videoQuality: quality,
             };
         } else {
             res = customErrors.error_1156;
         }
         return res;
     };
 
     that.getStreamStats = (stream, callback = () => { }) => {
         if (!socket) {
             return 'Error getting stats - no socket';
         }
         if (!stream) {
             return 'Error getting stats - no stream';
         }
 
         socket.sendMessage('getStreamStats', stream.getID(), (result) => {
             if (result) {
                 callback(result);
             }
         });
         return undefined;
     };
 
     // It searchs the streams that have "name" attribute with "value" value
     that.getStreamsByAttribute = (name, value) => {
         const streams = [];
 
         remoteStreams.forEach((stream) => {
             if (stream.getAttributes() !== undefined && stream.getAttributes()[name] === value) {
                 streams.push(stream);
             }
         });
 
         return streams;
     };
 
     that.installPlugin = () => {
         if (document.getElementById('WebrtcEverywherePluginId')) {
             return;
         }
         let isInternetExplorer = !!((Object.getOwnPropertyDescriptor && Object.getOwnPropertyDescriptor(window, 'ActiveXObject')) || ('ActiveXObject' in window));
         const isSafari = !!navigator.userAgent.indexOf('Safari');
         const pluginObj = document.createElement('object');
         if (isInternetExplorer) {
             pluginObj.setAttribute('classid', 'CLSID:7FD49E23-C8D7-4C4F-93A1-F7EACFA1EC53');
             isInternetExplorer = true;
         } else {
             pluginObj.setAttribute('type', 'application/webrtc-everywhere');
         }
         pluginObj.setAttribute('id', 'WebrtcEverywherePluginId');
         document.body.appendChild(pluginObj);
         pluginObj.setAttribute('width', '0');
         pluginObj.setAttribute('height', '0');
 
         if (pluginObj.isWebRtcPlugin || (typeof navigator.plugins !== 'undefined' && (!!navigator.plugins['WebRTC Everywhere'] || navigator.plugins['WebRTC Everywhere Plug-in for Safari']))) {
             Logger.info('Installed WEBRTC plugin for IE');
             EL.info('room-event', customEvents.event_general_success, { message: 'Installed WEBRTC plugin for IE' });
         } else {
             Logger.info('Browser does not appear to be WebRTC-capable');
             EL.warn('room-event', customEvents.event_incompatible_browser, { message: 'Browser does not appear to be WebRTC-capable' });
             window.open('/assets/plugin/VCXIE_PLUGINS.exe', 'new');
         }
     };
     that.sendStoredLogs = (logId, callback) => {
         that.socket.sendSDP('clientLogPosted', logId, Logger.storedBuff, (result, error) => {
             if (result) {
                 if (result) {
                     var res = {
                         result: 0,
                         message: 'Log posted successfully',
                     };
                     callback(res);
                 }
             } else {
                 var res = {
                     result: 1340,
                     message: 'Error in posing log',
                 };
                 callback(res);
             }
         });
     };
     //processes log
     that.postClientLogs = (tokenRef, callback = () => { }) => {
         /* */
         if (typeof callback === 'function') {
             const token = Base64.decodeBase64(tokenRef);
             const myData = config.getLocalStorageItem('vcxRTCLib-log');
             if (myData != null) {
                 const logId = JSON.parse(token).logId;
                 const dat = JSON.parse(myData);
 
                 const s = JSON.stringify(myData).replace(',', ', ').replace('{', '').replace('}', '');
                 that.sendStoredLogs(logId, callback);
                 return;
                 that.socket.sendSDP('clientLogPosted', logId, myData, (result, error) => {
                     if (result) {
                         if (result) {
                             var res = {
                                 result: 0,
                                 message: 'Log posted successfully',
                             };
                             callback(res);
                         }
                     } else {
                         var res = {
                             result: 1340,
                             message: 'Error in posing log',
                         };
                         callback(res);
                     }
                 });
             }
         }
         else {
             Logger.error('postClientLogs() invalid param - callback');
         }
     };
 
     //get the loacl(calling) user detail
     that.whoAmI = (callback = (arg) => { }) => {
         let currntUserDetails;
         that.userList.forEach(findMe);
         function findMe(item, index) {
             if (index === that.clientId) {
                 currntUserDetails = item;
             }
         }
         callback(currntUserDetails);
     };
 
     that.startScreenShare = (param1, param2) => {
         let callback, options;
         if (param1 != undefined && typeof param1 === 'function') callback = param1;
         else if (param2 != undefined && typeof param2 === 'function') {
             if (param1 != undefined) options = param1;
             callback = param2;
         }
         if (typeof callback === 'function') {
             let localStream;
             if (options == undefined){
                options = {};
                options.audio = 
                 (config.browser_info.name === 'chrome-stable' || config.browser_info.name === 'edge') ? true :false;
             }else if (options.audio == undefined) options.audio = false;
             options.layout = options.layout != undefined ? options.layout : 'grid';
             that.shareOverRide = false;
             if(options.shareOverride != undefined) {
                 that.shareOverRide = options.shareOverride;
             } else {
                 that.shareOverRide = that.share_override_room;
             }
             if(that.shareOverRide == true) {
                 that.shareOverRideCallback = callback;
             } else {
                 that.shareOverRideCallback = undefined;
             }
             if (that && that.share && (!that.subscription || that.subscription.audio_video)) {
                 localStream = startShare(options, (res) => {
                     if (res === true) {
                         that.publish(localStream, {
                             share: true,
                             maxVideoBW: config.video_bandwidth_range.share.max,
                             minVideoBW: config.video_bandwidth_range.share.min,
                             shareMetadata: {
                                 layout: options.layout
                             }
                         }, (response) => {
                             callback(response);
                             if (response.result === 0) {
                                 const additionalOptions = {
                                     streamId: localStream.getID(),
                                     negotiatedCodecs: {
                                         video: {
                                             codec: (that.mediaConfiguration === 'default' || that.mediaConfiguration === 'Default') ? 'VP8' : that.mediaConfiguration,
                                         },
                                         audio: {
                                             codec: 'OPUS',
                                         },
                                     },
                                     externalIp: that.externalIp,
                                 };
                                 Logger.info('additionalOptions:', additionalOptions);
                                 EL.info('room-event', customEvents.event_start_screenshare_success, { error: {} });
                                 adjustMainVideoQuality(true, that.canvasStatus);
                                 that.createEventLog('clientStreamShareSuccess', additionalOptions);
                             } else if (response.result === 4108) {
                                 const additionalOptions = {
                                     streamId: localStream.getID(),
                                     negotiatedCodecs: {
                                         video: {
                                             codec: (that.mediaConfiguration === 'default' || that.mediaConfiguration === 'Default') ? 'VP8' : that.mediaConfiguration,
                                         },
                                         audio: {
                                             codec: 'OPUS',
                                         },
                                     },
                                     externalIp: that.externalIp,
                                     error: response.msg,
                                 };
                                 that.createEventLog('clientStreamShareFailed', additionalOptions);
                                 EL.info('room-event', customEvents.event_start_screenshare_failed, { additionalOptions });
                                 localStream.stream.getTracks().forEach((track) => {
                                     track.stop();
                                 });
                             }
                         });
                     } else {
                         callback(res);
                     }
                 });
             } else {
                 const error = !that ? customErrors.error_1171 : customErrors.error_1170;
                 Logger.info('Room not connected../ licence error');
                 EL.info('room-event', customEvents.event_start_screenshare_failed, { error });
                 callback(error);
             }
             return localStream;
         }
         else {
             Logger.error('startScreenShare() invalid param - callback');
         }
     };
 
     that.getScreenShareStream = () => {
         return that.ScreenSharelocalStream;
     };
 
     /**
      * method to stop screen share
      */
     that.stopScreenShare = (shareStream, callback = () => { }) => {
         if (typeof callback === 'function') {
             let error = customErrors.error_1159;
             if (that && that.share && (!that.subscription || that.subscription.audio_video)) {
                 let stream2Remove;
                 that.localStreams.forEach((stream) => {
                     if (stream.ifScreen() && stream.local) {
                         discardLocalStreamForReconnect (true, false);
                         stream.close();
                         stream2Remove = stream;
                         error = customErrors.error_000;
                         EL.error('room-event', customEvents.event_stop_screenshare_success, { error: {} });
                     }
                 });
                 adjustMainVideoQuality(false, that.canvasStatus);
                 if (stream2Remove != undefined){
                   that.localStreams.remove(stream2Remove.getID());
                 }
             } else {
                 error = !that ? customErrors.error_1171 : customErrors.error_1170;
                 Logger.info('Room not connected../ licence error');
                 EL.info('room-event', customEvents.event_stop_screenshare_failed, { error });
             }
             // Note: 1st param is not required. Incase if application  passes only one param as callback, need to handle
             that.ScreenSharelocalStream = null;
             if (callback) {
                 callback(error);
             } else if (shareStream && (typeof shareStream === 'function')) {
                 shareStream(error);
             }
         }
         else {
             Logger.error('stopScreenShare() invalid param - callback');
         }
     };
 
     that.stopAllSharing = (callback) => {
         console.log('stopAllSharing');
         if (that.shareStatus == true || that.isCanvasSharing == true) {
             that.socket.sendParamEvent('stopAllSharing', that.clientId, (rsp) => {
                 if (rsp.result != 0) {
                     Logger.error(rsp.msg);
                     rsp.result = -1;
                     callback(rsp);
                 } else {
                     callback(rsp);
                 }
             });
         }
     }
 
     function validScope(scope) {
         if(scope == undefined || SCOPE.includes(scope) == false) {
             return false;
         }
         return true;
     }
     const onCustomDataSaved = (rsp) => {
         const evt = RoomEvent({ type: 'custom-data-saved', message: { result: rsp.result, scope:  rsp.scope} });
         that.dispatchEvent(evt);
     };
 
     const onCustomDataUpdated = (rsp) => {
         const evt = RoomEvent({ type: 'custom-data-updated', message: { result: rsp.result, scope:  rsp.scope, msg: rsp.msg} });
         that.dispatchEvent(evt);
     };
 
 
     that.saveCustomData = (scope, data, callback) => {
         var ret = { result: 0 };
         if(false == validScope(scope)) {
             ret.result = 1;
             ret.msg = "Invalid scope parameter: "+ scope;
             callback(ret);
             return;
         }
         if(data == undefined || typeof(data) != 'object') {
             ret.result = 1;
             ret.msg = "Invalid  data";
             callback(ret);
             return;
         }
         var keyArray = Object.keys(data);
         for (let app_key of keyArray) {
             if( app_key === '' ) {
                 ret.result = 1;
                 ret.msg = "Empty string as key not allowed.";
                 callback(ret);
                 return;
             }
         }
         //To check whether any scope's data has emptry string or null value as value of key.
         // for (let value of Object.values(data)) {
         //     if(value == null || value === ''){
         //         ret.result = 1;
         //         ret.msg = "Wrong value or data type of field !!";
         //         callback(ret);
         //         return;
         //     }
         // }
         //To check except session, does any scope has object as data type of key's value in custom data structure.
         // if(scope != SESSION) {
         //     for (let value of Object.values(data)) {
         //     if(typeof(value) == 'object'){
         //         ret.result = 1;
         //         ret.msg = "Wrong value or data type of field !!";
         //         callback(ret);
         //         return;
         //     }
         //     }
         // }
         var appData = {
             scope: scope, data: data
         };
         that.socket.sendParamEvent('saveCustomData',appData, (rsp) => {
             if (rsp.result != 0) {
                 Logger.error(rsp.msg);
                 callback(rsp);
             } else {
                 callback(rsp);
             }
         });
     }
     
     that.setCustomData = (scope, data, callback) => {
         var ret = { result: 0 };
         if(false == validScope(scope)) {
             ret.result = 1;
             ret.msg = "Invalid scope parameter: "+ scope;
             callback(ret);
             return;
         }
         if(data == undefined || typeof(data) != 'object') {
             ret.result = 1;
             ret.msg = "Invalid  data";
             callback(ret);
             return;
         }
         var keyArray = Object.keys(data);
         for (let app_key of keyArray) {
             if( app_key === '' ) {
                 ret.result = 1;
                 ret.msg = "Empty string as key not allowed.";
                 callback(ret);
                 return;
             }
         }
         //To check whether any scope's data has emptry string or null value as value of key.
         // for (let value of Object.values(data)) {
         //     if(value == null || value === ''){
         //         ret.result = 1;
         //         ret.msg = "Wrong value or data type of field !!";
         //         callback(ret);
         //         return;
         //     }
         // }
         //To check except session, does any scope has object as data type of key's value in custom data structure.
         // if(scope != SESSION) {
         //     for (let value of Object.values(data)) {
         //     if(typeof(value) == 'object'){
         //         ret.result = 1;
         //         ret.msg = "Wrong value or data type of field !!";
         //         callback(ret);
         //         return;
         //     }
         //     }
         // }
         var appData = {
             scope: scope, data: data
         };
         that.socket.sendParamEvent('setCustomData',appData, (rsp) => {
             if (rsp.result != 0) {
                 Logger.error(rsp.msg);
                 callback(rsp);
             } else {
                 callback(rsp);
             }
         });
     }
 
     that.getCustomData = (options, callback) => {
         var ret = { result: 0 };
 
         if(options == undefined || typeof(options) != 'object') {
             ret.result = 1;
             ret.msg = "Invalid  options";
             callback(ret);
             return;
         }
 
         if(false == validScope(options.scope)) {
             ret.result = 1;
             ret.msg = "Invalid scope parameter: "+ options.scope;
             callback(ret);
             return;
         }
         
         var appData = {
             scope: options.scope, options: options
         };
         that.socket.sendParamEvent('getCustomData',appData, (rsp) => {
             if (rsp.result != 0) {
                 Logger.error(rsp.msg);
                 callback(rsp);
                 // const evt = RoomEvent({ type: 'custom-data-updated', message: { result: rsp.result, scope:  rsp.scope, msg: rsp.msg} });
                 // that.dispatchEvent(evt);
             } else {
                 callback(rsp);
                 // const evt = RoomEvent({ type: 'custom-data-updated', message: { result: 0, scope:  rsp.scope} });
                 // that.dispatchEvent(evt);
             }
         });
     }
     that.lock = (callback) => {
         lockRoom(true, callback);
     };
 
     that.unlock = (callback) => {
         lockRoom(false, callback);
     };
 
     that.dropUser = (clientIds, callback = () => { }) => {
         if (clientIds === undefined || clientIds === null || Array.isArray(clientIds) &&
             typeof callback === 'function' && that.me.role === 'moderator') {
             const tempMsg = {};
             tempMsg.all = false;
             tempMsg.clientIds = (clientIds === undefined || clientIds === null) ? [] : clientIds;
             that.socket.emitEvent(VcxEvent.RoomEvent.drop, tempMsg, callback);
         } else if (typeof callback === 'function') {
             const resp = that.me.role !== 'moderator' ? customErrors.error_1168 : customErrors.error_1155;
             callback(resp);
         } else {
             Logger.error('dropUser() invalid param - callback');
         }
     };
 
     that.pinUsers = (clientIds, callback = () => { }) => {
         pinUsers(true, clientIds, callback);
     };
 
     that.unpinUsers = (clientIds, callback = () => { }) => {
         pinUsers(false, clientIds, callback);
     };
 
     that.addSpotlightUsers = (clientIds, callback = () => { }) => {
         spotLightUsers(true, clientIds, callback);
     };
 
     that.removeSpotlightUsers = (clientIds, callback = () => { }) => {
         spotLightUsers(false, clientIds, callback);
     };
 
 
     that.destroy = (callback = () => { }) => {
         if (typeof callback === 'function' && that.me.role === 'moderator') {
             const tempMsg = {};
             tempMsg.all = true;
             tempMsg.clients = null;
 
             that.socket.emitEvent(VcxEvent.RoomEvent.drop, tempMsg, (resp) => { });
         } else if (typeof callback === 'function') {
             EL.info('room-event', customEvents.event_general_success, { message: (`destroy - ${customErrors.error_1168}`) });
             callback(customErrors.error_1168);
         } else {
             Logger.error('() invalid param - callback');
         }
     };
 
     that.setAudioOnlyMode = (enable, callback = () => { }) => {
         if (enable !== undefined && typeof enable === 'boolean' && enable != that.audioOnlyMode && typeof callback === 'function') {
             const promises = [];
             const talkerInfo = {
                 numTalkers: that.userVideoTalkerCount,
                 numAudioTalkers: that.userAudioTalkerCount,
             };
 
             // enable - if publisher is active, mute cam , set all subscribers to mute video
             promises[0] = new Promise((resolve, reject) => {
                 talkerInfo.numVideoTalkers = enable ? 0 : that.userVideoTalkerCount;
                 that.socket.emitEvent(VcxEvent.RoomEvent.set_active_talker, talkerInfo, (result) => { resolve(result); });
             });
 
             promises[1] = new Promise((resolve, reject) => {
                 localStreams.forEach((stream, id) => {
                     if (stream && stream.ifVideo()) {
                         const muteFn = enable ? stream.muteVideo : stream.unmuteVideo;
                         muteFn((resp) => { resolve(resp); });
                     }
                 });
             });
 
             Promise.all(promises).then((values) => {
                 for (let i = 0; i < values.length; i++) {
                     if (values[i].result !== 0 && values[i].result !== customErrors.error_1177.result) {
                         callback(values[i].result);
                         return;
                     }
                 }
                 that.audioOnlyMode = enable;
                 callback(customErrors.error_000);
             });
         } else {
             const resp = enable === undefined || typeof enable !== 'boolean' ? customErrors.error_1168 : customErrors.error_1188;
             if (typeof callback === 'function') {
                 callback(resp);
             } else {
                 Logger.error('setAudioOnlyMode() invalid param - callback');
             }
         }
     };
 
     const validSpeakerDevice = (speakerId, callback) => {
         Connection.getDeviceList((resp) => {
             let found = false;
             if (resp.result == 0) {
                 for (let count = 0; count < resp.devices.speaker.length; count++) {
                     if (resp.devices.speaker[count].deviceId == speakerId) {
                         found = true;
                         break;
                     }
                 }
             }
             callback(found);
         });
     };
 
     const lockRoom = (lock, callback = () => { }) => {
         if (typeof callback === 'function') {
             if (that.me.role === 'moderator' && lock != that.locked) {
                 that.socket.emitEvent(VcxEvent.RoomEvent.lock_room, lock, (resp) => {
                     if (resp.result === 0) that.locked = lock;
                     callback(resp);
                 });
             } else {
                 const resp = that.me.role !== 'moderator' ? customErrors.error_1168 : customErrors.error_4121;
                 callback(resp);
             }
         } else {
             Logger.error('lockRoom() invalid param - callback');
         }
     };
 
     const pinUsers = (pin, clientIds, callback = () => { }) => {
         if (clientIds === undefined || clientIds === null || Array.isArray(clientIds) &&
             clientIds.length && typeof callback === 'function' && that.me.role === 'moderator') {
             const options = [{ id: 'update-pin-users', request: pin ? 'add' : 'remove', clientIds }];
             that.setAdvancedOptions(options, callback);
         } else if (typeof callback === 'function') {
             const resp = that.me.role !== 'moderator' ? customErrors.error_1168 : customErrors.error_1155;
             callback(resp);
         } else {
             Logger.error('pinUsers() invalid param - callback');
         }
     };
 
 
     const spotLightUsers = (spotlight, clientIds, callback = () => { }) => {
         if (clientIds === undefined || clientIds === null || Array.isArray(clientIds) &&
             clientIds.length && typeof callback === 'function' && that.me.role === 'moderator') {
             const options = [{ id: 'spotlight-users', request: spotlight ? 'add' : 'remove', clientIds }];
             that.setAdvancedOptions(options, callback);
         } else if (typeof callback === 'function') {
             const resp = that.me.role !== 'moderator' ? customErrors.error_1168 : customErrors.error_1155;
             callback(resp);
         } else {
             Logger.error('spotlightUsers() invalid param - callback');
         }
     };
 
     const processFloorRequest = (options, action, callback = () => { }) => {
         if (options !== undefined && typeof options === 'string') {
             that.socket.sendSDP('processFloorRequest', options, action, (result, error) => {
                 if (result === null) {
                     Logger.error(`Error on ${action} error: ${error}`);
                     callback(undefined, error);
                 } else {
                     callback(result);
                 }
             });
         } else {
             Logger.error(` Floor Req : ${action}Invalid params`);
             callback(undefined, customErrors.error_1155);
         }
     };
 
     /**
      *Send socket event
      * @param options Object of  options supplied | object
      * @param callback callback function
      */
     that.sendSocketEvent = (options, callback = () => { }) => {
         const event = 'logClientEvents';
         that.socket.emitEvent(event, options, (result, error) => {
             if (error) {
                 callback(error, 'error');
             } else {
                 callback(result, 'success');
             }
         });
     };
 
     /**
      * Create Event logs for various events
      * @param eventType Type of event
      * @param additionalOptions Json provided to merge with the common options
      */
     that.createEventLog = (eventType, additionalOptions) => {
         // Common options
         const options = {
             eventType,
             roomId: that.roomID,
             logId: token.logId,
             timestamp: new Date(),
         };
 
         // adding the additional-options to options object,  provided by the event
         Object.assign(options, additionalOptions);
 
         // Event callback
         const eventCallback = (resp, type) => {
             Logger.info(`Logging ${eventType} response:  ${JSON.stringify(resp)} , ${type} `);
         };
 
         // Logging event options
         Logger.info(`${eventType} :`, options);
         // send event to socket
         that.sendSocketEvent(options, eventCallback);
     };
 
     const sendSubscribersBitrate = () => {
         if (that.reconnectionState === false) {
             if (!that.sendRecvBitrateStats) {
                 that.sendRecvBitrateStats = true;
             }
             const promises = [];
             let index = 0;
             remoteStreams.forEach((stream) => {
                 if (stream.pc && stream.pc.peerConnection) {
                     promises[index] = stream.pc.peerConnection.getStats(null)
                         .then((results) => {
                             let bwInfo;
                             results.forEach((report) => {
                                 if ((report.type === 'candidate-pair') && (report.availableIncomingBitrate !== undefined)) {
                                     Logger.debug(`incoming bitrate: ${report.availableIncomingBitrate}`);
                                     bwInfo = {
                                         streamId: stream.getID(),
                                         availableRecvBitrate: parseInt(report.availableIncomingBitrate),
                                     };
                                 }
                             });
                             return (bwInfo || { streamId: stream.getID(), availableRecvBitrate: 0 });
                         }, (err) => {
                             console.log(err);
                             return ({
                                 streamId: stream.getID(),
                                 availableRecvBitrate: 0,
                             });
                         });
                     index++;
                 }
             });
 
             Promise.all(promises).then((values) => {
                 let bw = 0;
                 for (let i = 0; i < values.length; i++) {
                     bw += values[i].availableRecvBitrate;
                 }
                 Logger.info(`Bitrates Total:${bw} streamInfo: ${JSON.stringify(values)}`);
                 const stats = {
                     media: {
                         subscribers: {
                             totalAvailableBw: bw,
                         },
                     },
                 };
                 //send to server
                 that.socket.emitEvent(VcxEvent.RoomEvent.client_stats, stats, (result) => {
                 });
             });
             Logger.debug('Setting timeout again to execute ');
             setTimeout(sendSubscribersBitrate, 5000);
         } else {
             that.sendRecvBitrateStats = false;
         }
     };
 
     /**
      * Get Peer connection stats
      * @param streamPeerConnection Stream peerConnection
      * @param callback
      */
     const getPeerStats = (streamPeerConnection, callback) => {
         streamPeerConnection.getStats(null)
             .then((results) => {
                 getResults(results, (result) => {
                     callback(result);
                 });
             }, err => console.log(err));
     };
 
     /**
      *  Get candidate list and codecs
      * @param results
      * @param callback
      */
     let successIndex = 0;
     function getResults(results, callback) {
         let activeCandidatePair = null;
         let localCandidate = {};
         let remoteCandidate = {};
         const result = {};
         const codecsList = {};
         results.forEach((report) => {
             if (report.type === 'transport') {
                 activeCandidatePair = results.get(report.selectedCandidatePairId);
             }
             /**
              *  transportId = RTCTransport_audio_1, in new style
              *  earlier it was Conn-Audio-1
              *  */
             if (report.transportId == 'RTCTransport_audio_1' && report.ssrc && report.mediaType === 'audio') {
                 let codea = '';
                 results.forEach((item) => {
                     if (item.id === report.codecId) codea = item;
                 });
                 codecsList.audio = { codec: codea.mimeType };
             }
 
             if (report.transportId == 'RTCTransport_audio_1' && report.ssrc && report.mediaType === 'video') {
                 let codev = '';
                 results.forEach((item) => {
                     if (item.id === report.codecId) codev = item;
                 });
                 codecsList.video = { codec: codev.mimeType };
             }
         });
 
         // Fallback for Firefox.
         if (!activeCandidatePair) {
             results.forEach((report) => {
                 if (report.type === 'candidate-pair' && report.selected) {
                     activeCandidatePair = report;
                 }
             });
         }
 
         if (activeCandidatePair && activeCandidatePair.remoteCandidateId) {
             remoteCandidate = results.get(activeCandidatePair.remoteCandidateId).ip;
         }
 
         if (activeCandidatePair && activeCandidatePair.localCandidateId) {
             localCandidate = results.get(activeCandidatePair.localCandidateId).ip;
         }
 
         if ((localCandidate && Object.keys(localCandidate).length > 0) && (remoteCandidate && Object.keys(remoteCandidate).length > 0)) {
             successIndex++;
             result.selectedCandidates = {
                 local: localCandidate,
                 remote: remoteCandidate,
             };
         }
 
         if (Object.keys(codecsList).length > 0) {
             successIndex++;
             result.negotiatedCodecs = codecsList;
         }
 
         if (successIndex === 2) {
             Logger.info('result data: ', result);
             successIndex = 0;
             callback(result);
         }
     }
 
     const validateVideoResolution = (specInput, assignDefault) => {
         if (specInput.videoSize == undefined) {
             if (assignDefault) {
                 specInput.videoSize = [
                     videoResolutionRange.min.width,
                     videoResolutionRange.min.height,
                     videoResolutionRange.max.width,
                     videoResolutionRange.max.height,
                 ];
             } else {
                 Logger.error(' Failed : video size undefined');
                 return customErrors.error_1184;
             }
         } else {
             const minPixelsSet = specInput.videoSize[0] * specInput.videoSize[1];
             const maxPixelsSet = specInput.videoSize[2] * specInput.videoSize[3];
             const minPixelsConfig = videoResolutionRange.min.width * videoResolutionRange.min.height;
             const maxPixelsConfig = videoResolutionRange.max.width * videoResolutionRange.max.height;
             if (minPixelsSet < minPixelsConfig || minPixelsSet > maxPixelsConfig ||
                 maxPixelsSet > maxPixelsConfig || maxPixelsSet < minPixelsConfig ||
                 minPixelsSet > maxPixelsSet) {
                 Logger.error(` Failed : video size invalid minPixelsSet:${minPixelsSet} minPixelsConfig:${minPixelsConfig} maxPixelsSet: ${maxPixelsSet} maxPixelsConfig: ${maxPixelsConfig} req: min: ${specInput.videoSize[0]} X ${specInput.videoSize[1]} max: ${specInput.videoSize[2]} X ${specInput.videoSize[3]} config: min: ${videoResolutionRange.min.width} X ${videoResolutionRange.min.height} max: ${videoResolutionRange.max.width} X ${videoResolutionRange.max.height}`);
                 return customErrors.error_1184;
             }
         }
         return customErrors.error_000;
     };
 
     //////////////Publish Stream///////////////////
     that.initPublishStream = (domPlayerId, specInput, successCallback, errorCallback) => {
         let stream;
         if (specInput !== undefined) {
             if (specInput.audio || specInput.video || specInput.screen || specInput.canvas) {
                 if (specInput.video && (that.mediaConfiguration !== VcxEvent.constant.H264_CODEC)
                     && (config.browser_info.name === 'safari')
                     && config.browser_info.version <= VcxEvent.constant.SAFARI_VERSION_NOT_SUPPORTING_VP8) {
                     specInput.video = false;
                     Logger.info('Stream publish in Init publish:- SAFARI - false');
                 }
 
                 if (specInput.video & !specInput.canvas) {
                     const res = validateVideoResolution(specInput, true);
                     if (res.result !== customErrors.error_000.result) {
                         Logger.error(' Failed : initPublishStream(): video size invalid');
                         EL.error('room-event', customEvents.event_general_failed, { message: 'initPublishStream - video size invalid' });
                         errorCallback(res);
                         return;
                     }
                 }
 
                 console.log(`video Size: ${JSON.stringify(videoResolutionRange)} config.video_resolution_range: ${config.video_resolution_range} token.roomMeta.settings.quality: ${token.roomMeta.settings.quality} room meta: ${JSON.stringify(token.roomMeta)} video Size: ${config.video_resolution_range[token.roomMeta.settings.quality]}`);
 
                 if (specInput.videoSize == undefined || !specInput.videoSize.length) {
                     specInput.videoSize = [
                         videoResolutionRange.min.width,
                         videoResolutionRange.min.height,
                         videoResolutionRange.max.width,
                         videoResolutionRange.max.height,
                     ];
                 }
                 //   that.oldSpecInfo=specInput;
                 stream = EnxRtc.EnxStream(specInput);
             } else {
                 Logger.error(' Failed : all stream opions (audio/video/screen/canvas)  false/undefined');
                 EL.error('room-event', customEvents.event_general_failed, { message: 'initPublishStream - all stream opions (audio/video/screen/canvas) false/undefined' });
                 errorCallback(customErrors.error_1155);
             }
         } else {
             EL.info('room-event', customEvents.event_stream_publish_success, { message: 'initPublishStream - success' });
             stream = EnxRtc.EnxStream({
                 audio: true,
                 video: true,
                 data: true,
                 videoSize: [
                     videoResolutionRange.min.width,
                     videoResolutionRange.min.height,
                     videoResolutionRange.max.width,
                     videoResolutionRange.max.height,
                 ],
             });
         }
 
         if (Connection.browserEngineCheck() === 'IE') {
             const plugin = document.getElementById('WebrtcEverywherePluginId');
             plugin.addEventListener('media-access-allowed', (event) => {
                 Logger.info(`got media access:- ${JSON.stringify(event)}`);
                 if (document.getElementById(domPlayerId) !== null) {
                     stream.play(domPlayerId);
                 }
                 successCallback();
             });
         } else {
             stream.addEventListener('media-access-denied', errorCallback);
             stream.addEventListener('media-access-failed', errorCallback);
             stream.addEventListener('media-access-allowed', (event) => {
                 if (document.getElementById(domPlayerId) !== null) {
                     stream.play(domPlayerId, specInput.options);
                 }
                 successCallback(event.stream);
             });
         }
         stream.init();
         return stream;
     };
 
     /**
      * Start Share method
      * @param callback
      */
     const startShare = (options, callback) => {
         if (that.shareStatus && that.reconnectionState === false) {
             if (that.shareOverRide == false) {
                 callback(customErrors.error_1151);
             } else {
                 that.isOverRidingShare = true;
                 that.socket.sendParamEvent('screenShareOverRide', that.clientId, (result, error) => {
                     if (result === null) {
                         Logger.error('Error on stop screen share request', error);
                         callback(undefined, error);
                     } else {
                         //callback(result);
                     }
                 });
             }
             return;
         }
         const config = {
             video: true,
             data: true,
             screen: true,
             fps: that.screenResolutionRange.fps,
             attributes: {
                 name: 'share',
             },
         };
         that.whoAmI((arg) => { config.attributes.name = `${arg.name}_share`; });
         config.audio = (options != undefined && options.audio != undefined) ? options.audio : false;
 
         /*if (config.screen === false) {
             config.screen = true;
         }
 
         if (config.video === false) {
             config.video = true;
         }
 
         if (config.attributes === undefined) {
             config.attributes = { name: 'share' };
         } else if (config.attributes.name === undefined || config.attributes.name === 'share') {
             that.whoAmI((arg) => {
                 config.attributes.name = `${arg.name}_share`;
             });
         }*/
 
         const onAccessError = function (event) {
             if (event.msg.name === 'OverconstrainedError') {
                 Logger.info('Resolution selected is not supported by your webcam');
             }
             EL.error('room-event', customEvents.event_start_screenshare_failed, { event });
             callback(event.msg);
         };
 
         const onAccessSuccess = function () {
             EL.info('room-event', customEvents.event_start_screenshare_success, { error: {} });
             callback(true);
         };
 
         const stream = that.initPublishStream('', config, onAccessSuccess, onAccessError);
         return stream;
     };
 
 
     /**
      * Create the canvas element and add it to the DOM
      * @param selector : string  Selector ID, can be empty
      * @returns {string}: Canvas DOM Handle created
      */
     const createCanvas = (selector, appendTo = null, stream) => {
         if (selector) {
             return selector;
         }
         appendTo.style.position = 'relative';
         const annotateDiv = document.createElement('div');
         annotateDiv.setAttribute('class', 'annotate-div');
         annotateDiv.setAttribute('style', 'display:flex;justify-content: center;align-items: center;height: 100%;width: 100%;')
         const parentPlayerDiv = document.querySelector(`#player_${stream.getID()}`).parentElement;
         const canvas = document.createElement('canvas');
         const domHandle = `${that.canvasVideoPlayer}_veneer`;
         canvas.id = domHandle;
         canvas.width = appendTo ? appendTo.clientWidth : that.canvasOptions.width;
         canvas.height = appendTo ? appendTo.clientHeight : that.canvasOptions.height;
         appendTo.style.height = `${canvas.height}px`;
         appendTo.style.width = `${canvas.width}px`;
         canvas.className = `${that.canvasVideoPlayer}_input_veneer`;
         canvas.setAttribute('style', 'display:none;');
         document.body.appendChild(canvas);
       
         if (appendTo) {
             that.canvasOptions.width = appendTo.clientWidth;
             that.canvasOptions.height = appendTo.clientHeight;
             const wrapper = document.createElement('div');
             wrapper.setAttribute('id', 'canvas-wrapper');
             wrapper.setAttribute('class', 'canvas-wrapper');
             wrapper.style = 'position:absolute;top:0;';
             wrapper.append(canvas);
             Annotate.appendCustomCanvas(
                 wrapper,
                 canvas.className,
                 canvas.width,
                 canvas.height,
             );
             Annotate.appendCanvasFrame(
                wrapper,
                canvas.className,
                stream
                
             );
             document.getElementById(appendTo.id).appendChild(wrapper);
         } else {
             document.body.appendChild(wrapper);
         }
         if (appendTo != null) {
             annotateDiv.appendChild(appendTo);
             parentPlayerDiv.prepend(annotateDiv);
         }
         Annotate.bindEventListernersForTools();
         that.inputContext = canvas.getContext('2d');
         updateCanvas();
        
 
         return domHandle;
     };
 
    
    
     
 
   
     
 
     /**
      *  Add the video frames to canvas context using dawImage fn, and updating frames recursively using 'requestAnimationFrame'
      */
     const updateCanvas = () => {
         const drawImageData = document.getElementById('draw_veneer2');
         if (!drawImageData) {
             return;
         }
         const drawImageURL = drawImageData.toDataURL('image/png');
         const drawImage = new Image();
         drawImage.onload = function () {
             that.inputContext.globalAlpha = 1;
             that.inputContext.drawImage(drawImage, 0, 0, drawImageData.width, drawImageData.height);
         };
         drawImage.src = drawImageURL;
         
         const drawstreamFramecanvas = document.getElementById('draw_frame');
         const drawvideoframeURL = drawstreamFramecanvas.toDataURL('image/png');
         const drawFrame = new Image();
         drawFrame.onload = function () {
             that.inputContext.globalAlpha = 0.1;
             that.inputContext.drawImage(drawFrame, 0, 0, drawImageData.width, drawImageData.height);
         }
         drawFrame.src =drawvideoframeURL;
        
         requestAnimationFrame(updateCanvas);
     };
 
     that.annotateToolAction = function (action, value) {
         Annotate.toolBarAction(action, value);
     };
 
     /**
   * Start Annotation method used to start Annotation over streaming
   * @stream stream
   * @stream callback
   * @returns Ack
   */
     that.startAnnotation = (stream, callback) => {
         let canvasWrapper = document.getElementById('canvas-wrapper');
         
         if (canvasWrapper) canvasWrapper.remove();
         try {
             if (!stream) {
                 return;
             }
             const stream_id = stream.getID();
             const playerDOMID = document.querySelector(`#player_${stream_id}`);
             if (!playerDOMID) {
                 return;
             }
             const status = validateCanvas();
             console.log(status, 'status');
             that.canvas_video_player = document.getElementById(`stream${stream_id}`);
             that.canvasVideoPlayer = `stream${stream_id}`;
             if (status.result === customErrors.error_000.result) {
                 const canvasDomID = createCanvas(null, playerDOMID, stream);
                 const props = {
                     canvasSelector: canvasDomID,
                     fps: 23,
                     canvasType: 'Annotation',
                 };
                 that.startCanvas(props, (arg) => {
                     // @todo - what is the purpose of this line?
                     if (arg.result == 0) { 
                         if (callback) callback(status);
                     }
                 });
                 isCaptchaStarted = false;
                 isAnnotationStarted = true;
                 EL.info('room-event', customEvents.event_start_annotation_success, { error: {} });
                 Annotate.mouseAnnotate(
                     canvasDomID,
                     that.inputContext,
                     `player_${stream_id}`,
                     stream
                 );
                 // if (callback) callback(status);
             } else if (callback) {
                 callback(status);
             }
         } catch (error) {
             console.info(error, 'error');
             Logger.error(`incorrect annotate params ${error}`);
             EL.error('room-event', customEvents.event_start_annotation_failed, { error });
             if (callback) callback(customErrors.error_1155);
         }
     };
 
     /**
        * Stop Annotation method used to Stop Annotation over streaming
        * @stream callback
        * @returns Ack
     */
     that.stopAnnotation = (callback) => {
         isAnnotationStarted = false;
         that.stopCanvas(callback);
         Annotate.stopAnnotation();
       //  Annotate.startAgain();
     };
 
     /**
        * Adjustcanvas function adjust the size of canvas according to the stream size
     */
     that.adjustCanvas = () => {
         Annotate.resize();
     }
 
 
 
     /**
      * Start Canvas method used to start canvas streaming
       * @param params
      * @param callback
      * @returns localStream
      */
     that.startCanvas = (params, callback = () => { }) => {
         if (typeof (callback) === 'function') {
             let localStream,
                 canvasDomID;
             const selector = params ? params.canvasSelector : '';
             try {
                 const status = validateCanvas();
                 if (status.result === customErrors.error_000.result) {
                     canvasDomID = createCanvas(selector);
                     let frameRate;
                     let canvasType;
                     if (params) {
                         frameRate = params.fps ? params.fps : that.canvasOptions.fps;
                         canvasType = params.canvasType ? params.canvasType : 'default';
                     } else {
                         frameRate = that.canvasOptions.fps;
                         canvasType = 'default';
                     }
                     /*if (params.refreshFn === undefined){
                     var onCanvasRefresh = function () {
                         console.log("default wb.canvas inside refresh: "  + wb);
                         if (wb != undefined && wb.canvas !== undefined){
                         console.log("wb.canvas.add inside refresh " );
                         wb.canvas.add();
                         }
                     };
                     params.refreshFn = onCanvasRefresh;
                     }*/
                     const props = {
                         domHandle: canvasDomID,
                         fps: frameRate > 23 ? 23 : frameRate,
                         canvasType,
                         refreshFn: params.refreshFn,
                         maxRefreshRate: that.maxCanvasRefreshRate,
                     };
                     localStream = initCanvas(props, (res, type) => {
                         if (type === 'success') {
                             that.publish(
                                 res, {
                                 canvas: true,
                                 canvasType,
                                 maxVideoBW: config.video_bandwidth_range.canvas.max,
                                 minVideoBW: config.video_bandwidth_range.canvas.min,
                             },
                                 (response) => {
                                     if (response.result === 0) {
                                         Logger.info('startCanvas response.result:', response);
                                         EL.info('room-event', customEvents.event_start_canvas_success, { error: {} });
                                         adjustMainVideoQuality(that.shareStatus, true);
                                         if (callback) callback(response);
                                     }
                                 },
                             );
                         } else if (callback) {
                             callback(res);
                         }
                     });
                 } else if (callback) {
                     callback(status);
                 }
             } catch (error) {
                 Logger.error(`incorrect canvas params ${error}`);
                 EL.error('room-event', customEvents.event_start_canvas_failed, { error });
                 if (callback) {
                     callback(customErrors.error_1155);
                 }
             }
             return localStream;
         } else {
             Logger.error('startCanvas() invalid param - callback');
         }
     };
 
     /**
      *  Method to set video object for canvas and start the canvas streaming
      * @param videoPlayerId
      * @param options
      * @param callback
      */
     that.playVideo = (videoPlayerId, options, callback) => {
         that.canvasVideoPlayer = videoPlayerId;
         const playerObject = document.querySelector(`#${videoPlayerId}`); // Get the player object using the selector
 
         //if player does not exist in DOM return error
         if (playerObject === undefined || playerObject === null) {
             callback(customErrors.error_1162);
         } else {
             // Set the canvas options and start the canvas
             that.canvas_video_player = playerObject;
             if (options) {
                 that.canvasOptions.width = options.width ? options.width : that.canvasOptions.width;
                 that.canvasOptions.height = options.height ? options.height : that.canvasOptions.height;
                 that.canvasOptions.fps = options.fps ? options.fps : 23;
             }
             that.startCanvas({ fps: options.fps }, callback);
         }
     };
 
     /**
      * method to stop screen share
      * @param callback
      */
     that.stopCanvas = (callback = () => { }) => {
         if (typeof (callback) === 'function') {
             const status = validateCanvas();
             if (status.result === customErrors.error_000.result) {
                 let stream2Remove;
                 that.localStreams.forEach((stream) => {
                     if (stream && stream.ifCanvas()) {
                         discardLocalStreamForReconnect (false, true);
                         stream2Remove = stream;
                         stream.stream.getTracks().forEach((track) => {
                             track.stop();
                         });
                         stream.onStateChanged(false);
                         stream.close();
                         EL.info('room-event', customEvents.event_stop_canvas_success, { error: {} });
                         callback({ result: 0, msg: 'Canvas stopped successfully.' });
                     }
                 });
                 adjustMainVideoQuality(that.shareStatus, false);
                 if (stream2Remove != undefined)
                   that.localStreams.remove(stream2Remove.getID());
             } else {
                 EL.error('room-event', customEvents.event_stop_canvas_failed, { error: {} });
                 callback(status);
             }
         } else {
             Logger.error('stopCanvas() invalid param - callback');
         }
     };
 
     that.isModerator = () => (that.me && that.me.role === 'moderator');
 
     const sendRemoteMediaDeviceControlRequest = (req, mic, cam, broadcast, remClientId, callback) => {
         const error = validatePermission(mic, cam, true);
         if ((error.result === customErrors.error_000.result) && (broadcast || (remClientId && (typeof remClientId === 'string')))) {
             that.socket.sendMessage(req, { clientId: remClientId }, (resp) => {
                 callback(resp);
             });
         } else {
             callback((error.result !== customErrors.error_000.result) ? error : customErrors.error_1155);
         }
     };
 
     const validatePermission = (check_audio, check_video, check_moderator) => {
         const subscription = (!that.subscription || ((!check_video || that.subscription.audio_video) &&
             (!check_audio || (that.subscription.audio_only || that.subscription.audio_video))));
 
         if (that && subscription && (!check_moderator || (that.me.role === 'moderator'))) {
             return customErrors.error_000;
         }
 
         const error = !that ? customErrors.error_1171 : !subscription ? customErrors.error_1170 : customErrors.error_1168;
         Logger.error(`validateCanvas error code ${error.result}`);
         return error;
     };
 
     const validateCanvas = () => {
         if (that && (!that.subscription || that.subscription.audio_video) &&
             ((that.mode !== 'lecture') || (that.me.role === 'moderator') || (that.floorGranted === true))) {
             return customErrors.error_000;
         }
         const error = !that ? customErrors.error_1171 : (!that.subscription || that.subscription.audio_video) ?
             customErrors.error_1173 : customErrors.error_1170;
         Logger.error(`validateCanvas error code ${error.result}`);
         return error;
     };
 
     const initCanvas = (props, callback) => {
         let stream = null;
         const config = {
             video: true,
             canvas: true,
             attributes: {
                 name: 'canvas',
             },
         };
 
         if (config.canvas === false) {
             config.canvas = true;
         }
 
         if (config.video === false) {
             config.video = true;
         }
 
         if (config.audio === true) {
             config.audio = false;
         }
 
         if (!config.div) {
             config.div = props.domHandle;
         }
 
         if (!config.fps) {
             config.fps = props.fps;
         }
 
         if (props.refreshFn != undefined) {
             config.refreshFn = props.refreshFn;
             config.maxCanvasRefreshRate = props.maxRefreshRate;
         }
 
         if (config.attributes === undefined) {
             config.attributes = { name: 'canvas' };
         } else if (config.attributes.name === undefined || config.attributes.name === 'canvas') {
             that.whoAmI((arg) => {
                 config.attributes.name = `${arg.name}_canvas`;
             });
         }
 
         const onAccessError = function (event) {
             if (event.msg.name === 'OverconstrainedError') {
                 Logger.info('Resolution selected is not supported by your webcam');
             }
             callback(event.msg, 'error');
         };
 
         const onAccessSuccess = function (st) {
             stream = st;
             callback(stream, 'success');
         };
 
         // config.fps = 23;
         config.videoSize = [1920, 1080, 1920, 1080];
         Logger.info(`initcanvas config ${JSON.stringify(config)}`);
         that.initPublishStream('', config, onAccessSuccess, onAccessError);
         return stream;
     };
 
     const onCanvasStarted = (arg) => {
         let evt = null;
         that.isCanvasSharing = true;
         if (that.clientId == arg.clientId) {
             that.isCanvasSharingClient = true;
         }
         if (isCaptchaStarted) {
             evt = RoomEvent({
                 type: 'annotation-started-ack',
                 message: {
                     clientId: arg.clientId,
                     name: arg.name,
                     streamId: arg.streamId,
                     canvasType: arg.canvasType,
                 },
             });
         } else if (arg.canvasType === 'Annotation') {
             isAnnotationStarted = true;
             evt = RoomEvent({
                 type: 'canvas-started',
                 message: {
                     clientId: arg.clientId,
                     name: arg.name,
                     streamId: arg.streamId,
                     canvasType: arg.canvasType,
                 },
             });
         } else {
             that.canvasStatus = true;
             if (isAnnotationStarted) {
                 that.canvasStatus = false;
             }
             isAnnotationStarted = false;
             evt = RoomEvent({
                 type: 'canvas-started',
                 message: {
                     clientId: arg.clientId,
                     name: arg.name,
                     streamId: arg.streamId,
                     canvasType: arg.canvasType ? arg.canvasType : 'default',
                 },
             });
         }
         adjustMainVideoQuality(that.shareStatus, true);
         that.dispatchEvent(evt);
         Logger.debug('onCanvasStarted event :', JSON.stringify(evt));
         if (arg.streamId) {
             const stream = remoteStreams.get(arg.streamId);
             if (stream && !stream.failed) {
                 // forcing canvas subscriber stream to take HD layer with appropriate temporal layers
                 stream._setStaticQualityLayer(2, -1, (result) => {
                     Logger.info(`stream._setStaticQualityLayer (2/-1) for canvas result : ${result}`);
                 });
             } else {
                 Logger.error('canvas started:stream is undefined or failed');
             }
         } else {
             Logger.error('canvas arg.streamId is undefined');
         }
     };
 
     const onCanvasStopped = (arg) => {
         const evt = RoomEvent({ type: 'canvas-stopped', message: { clientId: arg.clientId, name: arg.name, streamId: arg.streamId } });
         that.canvasStatus = false;
         that.isCanvasSharing = false;
         adjustMainVideoQuality(that.shareStatus, false);
         Logger.debug('onCanvasStopped event :', JSON.stringify(evt));
         that.dispatchEvent(evt);
         that.isCanvasSharingClient = false;
     };
 
     const onCanvasStateEvents = (arg) => {
         Logger.info('canvasStateEvents');
         if (arg.videomuted === true) {
             const evt = RoomEvent({ type: 'canvas-state-events', message: 'Canvas stopped', reason: 'bw' });
             that.dispatchEvent(evt);
         } else {
             const evt = RoomEvent({ type: 'canvas-state-events', message: 'Canvas resumed', reason: 'bw' });
             that.dispatchEvent(evt);
         }
     };
 
     const onShareStateEvents = (arg) => {
         Logger.info('shareStateEvents');
         if (arg.videomuted === true) {
             const evt = RoomEvent({ type: 'share-state-events', message: 'Share stopped', reason: 'bw' });
             that.dispatchEvent(evt);
         } else {
             const evt = RoomEvent({ type: 'share-state-events', message: 'Share resumed', reason: 'bw' });
             that.dispatchEvent(evt);
         }
     };
 
     const onGenericEvents = (arg) => {
         if (arg.id === 'speaker_notification') {
             arg.id = 'talker-notification';
             let eventDetails = {};
             let talkerArray = arg.data;
             for (const talkerInfo of talkerArray) {
                 if (talkerInfo.speech === true) {
                     eventDetails.speech = talkerInfo.users;
                 } else if (talkerInfo.noise === true) {
                     eventDetails.noise = talkerInfo.users;
                 }
             }
             const evt = RoomEvent({ type: arg.id, message: eventDetails });
             that.dispatchEvent(evt);
         } else {
             const evt = RoomEvent({ type: arg.id, message: arg.data });
             that.dispatchEvent(evt);
         }
     };
 
     const onUserRoleChangedEvent = (arg) => {
         Logger.debug(`onUserRoleChangedEvent${JSON.stringify(arg)} ownclientId: ${that.clientId}`);
         if (arg.moderator.new === that.clientId) {
             if (that.me.role === 'participant') {
                 that.me.role = 'moderator';
                 if (that.mode === 'lecture') {
                     that.cCrequest = [];
                     that.cCapprovedHands = [];
                     if (arg.raisedHands.length > 0) {
                         arg.raisedHands.forEach((item) => {
                             that.cCrequest.push(item);
                         });
                     }
                     if (arg.approvedHands.length > 0) {
                         arg.approvedHands.forEach((item) => {
                             that.cCapprovedHands.push(item);
                         });
                     }
                 } else {
                     //group mode
                 }
             } else {
                 Logger.info('onUserRoleChangedEvent() Already Moderator - no change');
             }
         } else if (arg.moderator.old === that.clientId) {
             if (that.me.role === 'moderator') {
                 that.me.role = 'participant';
                 if (that.mode === 'lecture') {
                     that.cCrequest = [];
                     that.cCapprovedHands = [];
                     const lstrm = that.localStreams.getAll();
                     localStreams.forEach((stream, id) => {
                         that.unpublish(stream, (arg) => {
                             if (arg == true) {
                                 Logger.info('stream has been un-published');
                             } else {
                                 Logger.info('error during stream un-publishing');
                                 EL.error('room-event', customEvents.event_stream_unpublish_failed, { stream });
                             }
                         });
                     });
                 }
             } else {
                 Logger.info('onUserRoleChangedEvent() Already partcipant - no change');
             }
         }
         const evt = RoomEvent({ type: 'user-role-changed', message: arg });
         that.dispatchEvent(evt);
     };
 
     const onRoomSwitched = (arg) => {
         Logger.debug(`onUserRoleChangedEvent${JSON.stringify(arg)} ownclientId: ${that.clientId}`);
         if (that.mode === 'lecture') {
             that.mode = 'group';
             that.roomSettings.mode = 'group'
             that.cCrequest = [];
             that.cCapprovedHands = [];
         } else {
             if (that.mode === 'group') {
                 that.roomSettings.mode = 'lecture'
                 that.mode = 'lecture';
                 that.cCrequest = [];
                 that.cCapprovedHands = [];
                 //Group to lecture mode, do all unpublish
                 //Have all the data structure created.
                 if (that.me.role === 'participant') {
                     localStreams.forEach((stream, id) => {
                         that.unpublish(stream, (arg) => {
                             if (arg == true) {
                                 Logger.info('stream has been un-published');
                             } else {
                                 Logger.info('error during stream un-publishing');
                                 EL.error('room-event', customEvents.event_stream_unpublish_failed, { stream });
                             }
                         });
                     });
                 } else {
                     Logger.info('onUserRoleChangedEvent() Already Moderator - no change');
                 }
             }
         }
         const evt = RoomEvent({ type: 'room-mode-switched', message: { mode: that.mode, moderator: arg.moderator } });
         that.dispatchEvent(evt);
     };
 
     const onRoomManagementEvents = (arg) => {
         Logger.info(`onRoomManagementEvents:${JSON.stringify(arg)}`);
         let msg = {};
         switch (arg.id) {
             case 'room-locked':
             case 'room-unlocked':
                 that.locked = arg.id === 'room-locked';
                 msg = arg.msg;
                 break;
             case 'floor-opened':
                 that.floorOpen = true;
                 break;
             case 'floor-closed':
                 that.floorOpen = false;
                 break;
             case 'knock-enabled':
                 that.knockEnabled = true;
                 break;
             case 'knock-disabled':
                 that.knockEnabled = false;
                 that.awaitedParticipants.clear();
                 break;
             case 'wait-room-disabled':
                 if (that.waitRoom) {
                     that.waitRoom = false;
                 }
                 let stream;
                 const streamList = [];
                 const streams = arg.roomData.streams || [];
                 const streamIndices = Object.keys(streams);
                 const userList = arg.roomData.userList;
 
                 for (let index = 0; index < streamIndices.length; index += 1) {
                     const arg = streams[streamIndices[index]];
                     stream = Stream(that.Connection, {
                         streamID: arg.id,
                         local: false,
                         audio: arg.audio,
                         video: arg.video,
                         data: arg.data,
                         screen: arg.screen,
                         canvas: (!(typeof arg.canvas === 'undefined' || arg.canvas === false)),
                         attributes: arg.attributes,
                     });
                     streamList.push(stream);
                     remoteStreams.add(arg.id, stream);
                 }
 
                 for (const user in userList) {
                     that.userList.set(userList[user].clientId, userList[user]);
                 }
                 that.videoMutedUsers = arg.roomData.videoMutedUsers || [];
                 msg = { streams: streamList, users: userList };
                 break;
 
             default:
                 msg = arg.msg;
         }
         const evt = RoomEvent({ type: arg.id, message: msg });
         that.dispatchEvent(evt);
     };
 
     const onInviteBreakOutRoom = (msg) => {
         Logger.info(`Recieved an invite to join breakout room ${JSON.stringify(msg)}`);
         Logger.info('Join Breakout Room event dispatched');
         if (msg.force_join === true) {
             const invite = RoomEvent({
                 type: 'breakout-room-joining',
                 message: { room_id: msg.room_id, requestor: msg.requestor }
             });
             that.dispatchEvent(invite);
             const data = { audio: true, video: true };
             that.muteRoom(data, (response) => {
                 if (response.result === 0) {
                     localStreams.forEach((stream, id) => {
                         if (!stream.screen && !stream.canvas && (stream.ifAudio() || stream.ifVideo())) {
                             let roomInfo = { room_id: msg.room_id, role: 'participant' };
                             that.joinBreakOutRoom(roomInfo, { audio: true, video: false }, (resp, err) => {
                                 if (resp) {
                                     const connectEvt = RoomEvent({
                                         type: 'breakout-room-connected',
                                         streams: resp.streams, room: resp.room, roomData: resp.roomData,
                                         localBreakoutStream: resp.localBreakoutStream
                                     });
                                     that.dispatchEvent(connectEvt);
                                 } else if (err) {
                                     const connectEvt = RoomEvent({ type: 'breakout-room-error', message: err });
                                     that.dispatchEvent(connectEvt);
                                 }
                             });
                         }
                     });
                 } else {
                     let evnt = RoomEvent({ type: 'breakout-room-error' }, { message: ('mute room request failed') });
                     that.dispatchEvent(evnt);
                 }
             });
             return;
         }
         const inviteEvt = RoomEvent({ type: 'join-breakout-room', message: { room_id: msg.room_id, requestor: msg.requestor } });
         that.dispatchEvent(inviteEvt);
     };
 
 
     that.rejectBreakoutRoomInvite = (room_id, callback = () => { }) => {
         Logger.info(`Rejecting the breakout room invite `, room_id);
         if (room_id) {
             that.socket.sendMessage('reject-breakout-room', room_id, (result) => {
                 if (result) {
                     Logger.info(`Reject breakout room, result: ${JSON.stringify(result)}`);
                     callback(result);
                 }
             });
         } else {
             Logger.info(`Invalid value room_id`);
             if (callback) {
                 callback(customErrors.error_1155);
             }
         }
     };
 
     const onUserJoinedBreakOutRoom = (data) => {
         Logger.info(`Recieved user joined breakout room ${JSON.stringify(data)}`);
         const joinedEvt = RoomEvent({ type: 'user-joined-breakout-room', message: { clientId: data.client } });
         that.dispatchEvent(joinedEvt);
     };
 
     const onUserDisconnectedBreakOutRoom = (data) => {
         Logger.info(`USER DISCONNECTED BREAKOUT ROOM ${JSON.stringify(data)}`);
         const disconnEvt = RoomEvent({ type: 'user-disconnected-breakout-room', message: { name: data.name, clientId: data.clientId, room: data.room } });
         that.dispatchEvent(disconnEvt);
     };
 
     const onBreakOutRoomDestroyed = (data) => {
         Logger.info(`BREAKOUT ROOM DESTROYED${JSON.stringify(data)}`);
         const destroyEvt = RoomEvent({ type: 'breakout-room-destroyed', message: { room_id: data.room_id } });
         that.dispatchEvent(destroyEvt);
     };
     
     const onTranscriptionEvents = (data) => {
         Logger.info(`Received transcription events: ${JSON.stringify(data)}`);
         const transEvt = RoomEvent({ type: 'transcription-events', message: {data} });
         that.dispatchEvent(transEvt);
     };
 
     that.extendConferenceDuration = (callback = () => { }) => {
         if (typeof callback === 'function') {
             that.socket.emitEvent(VcxEvent.RoomEvent.extend_conference_duration, {}, (result) => {
                 callback(result);
             });
         } else {
             Logger.error('extendConferenceDuration() : failed Invalid param. callback is not function');
         }
     };
 
     that.subscribeMediaStats = (reqType, callback = () => { }) => {
         if (reqType !== undefined && typeof reqType === 'string' && typeof callback === 'function') {
             if (that.state === CONNECTED && that.mediaStatsMode != reqType &&
                 (reqType == 'disable' || reqType == 'notify' || reqType == 'display' || reqType == 'notify-display')) {
                 const setDisplayStyle = (style) => {
                     const selecterStringsButton = document.querySelectorAll('.stats-container');
                     const selecterStringsOverlay = document.querySelectorAll('.stats-overlay');
                     selecterStringsButton.forEach((selecterString) => {
                         if ((selecterString !== undefined) && (selecterString !== null)) {
                             selecterString.style.display = style;
                         }
                     });
                     selecterStringsOverlay.forEach((selecterString) => {
                         if ((selecterString !== undefined) && (selecterString !== null)) {
                             selecterString.style.display = style;
                         }
                     });
                 };
                 if (reqType == 'disable' || that.mediaStatsMode == 'disable') {
                     //currently server stats based on local streamID.. need to change
                     localStreams.forEach((stream, id) => {
                         if (!stream.ifCanvas() && !stream.ifScreen()) {
                             socket.sendMessage(
                                 'subscribeStreamStatsForClient', { streamId: id, statsEnabled: reqType != 'disable' },
                                 (result) => {
                                     if (result != undefined) {
                                         if (result.status === 'Success') {
                                             setDisplayStyle((reqType == 'display' || reqType == 'notify-display') ? 'block' : 'none');
                                         }
                                         that.mediaStatsMode = reqType;
                                     }
                                 },
                             );
                         }
                     });
                 } else {
                     setDisplayStyle((reqType == 'display' || reqType == 'notify-display') ? 'block' : 'none');
                     that.mediaStatsMode = reqType;
                 }
             } else {
                 let err;
                 if (that.state !== CONNECTED) {
                     err = customErrors.error_1171;
                 } else if (that.mediaStatsMode == reqType) {
                     err = customErrors.error_1188;
                 } else {
                     err = customErrors.error_1155;
                 }
                 Logger.error(`that.subscribeMediaStats () error: ${JSON.stringify(err)}`);
                 callback(err);
             }
         } else {
             Logger.error('that.subscribeMediaStats () invalid param ');
             if (typeof callback === 'function') {
                 callback(customErrors.error_1155);
             }
         }
     };
 
     that.subscribeStreamStatsForClient = (stream, statsEnabled, callback = () => { }) => {
         if (!socket) {
             return 'Error getting stats - no socket';
         }
         if (!stream) {
             return 'Error getting stats - no stream';
         }
         socket.sendMessage('subscribeStreamStatsForClient', { streamId: stream.getID(), statsEnabled }, (result) => {
             if (result) {
                 const selecterStringsButton = document.querySelectorAll('.stats-container');
                 const selecterStringsOverlay = document.querySelectorAll('.stats-overlay');
 
                 //To Do : need result/error code will send the result code
                 if (result.status === 'Success' && statsEnabled === true) {
                     that.mediaStatsMode = 'display';
                     that.subscribeSessionStats = true;
                     selecterStringsButton.forEach((selecterString) => {
                         if ((selecterString !== undefined) && (selecterString !== null)) {
                             selecterString.style.display = 'block';
                         }
                     });
                     selecterStringsOverlay.forEach((selecterString) => {
                         if ((selecterString !== undefined) && (selecterString !== null)) {
                             selecterString.style.display = 'block';
                         }
                     });
                 } else {
                     that.mediaStatsMode = 'disable';
                     that.subscribeSessionStats = false;
                     selecterStringsButton.forEach((selecterString) => {
                         if ((selecterString !== undefined) && (selecterString !== null)) {
                             selecterString.style.display = 'none';
                         }
                     });
                     selecterStringsOverlay.forEach((selecterString) => {
                         if ((selecterString !== undefined) && (selecterString !== null)) {
                             selecterString.style.display = 'none';
                         }
                     });
                 }
                 callback(result);
             }
         });
         return undefined;
     };
 
     that.subscribeForTalkerNotification = (enabled, callback = () => { }) => {
         if (typeof callback === 'function') {
             if (!socket) {
                 return 'Error subscribing - no socket';
             }
             let advancedOptions = [{ id: 'speaker-notification', enable: enabled }];
             that.setAdvancedOptions(advancedOptions, callback);
         }
         else {
             Logger.error('subscribeForTalkerNotification() invalid param - Callback');
         }
     };
 
 
 
 
 
     that.manageStatsSubscription = (stream) => {
         if (that.mediaStatsMode != 'disable') {
             const reqType = that.mediaStatsMode;
             that.mediaStatsMode = 'disable';
             that.subscribeMediaStats(reqType, (result) => { });
         } else if (that.subscribeSessionStats === true) {
             Logger.info('resubscribe session stats');
             that.subscribeStreamStatsForClient(stream, that.subscribeSessionStats);
         } else {
             Logger.info('session stats not subscribed');
         }
     };
 
     that.reconPubSubFailed = (message) => {
         // after reconnect publish or subscribe failed, we should clear all peer connection and streams and emit event
         Logger.info('reconnect publish or subscribe failed', message);
         that.reconnectionAllowed = false;
         clearAll();
         // send reconnection timeout event to application
         const reconnectionTimedOut = RoomEvent({ type: 'network-reconnect-timeout', error: customErrors.error_1167.result, message });
         that.dispatchEvent(reconnectionTimedOut);
     };
 
     that.manageNumTalker = () => {
         Logger.info('Reset the preferred number of active talkers');
         if (prefNumTakler !== -1) {
             that.setTalkerCount(prefNumTakler, (result) => {
                 Logger.info('reset active talker', result);
             });
         } else {
             Logger.info('Use default prefrence of number of active talkers');
         }
     };
 
     that.startLiveTranscription = (callback = () => { }) => {
       Logger.info('Starting the live operation');
       if(that.liveTranscription === false) {
         Logger.info('Sending the socket message');
         that.socket.sendEvent('startLiveTranscription', (response) => {
           if(response && response.result === 0) {
             that.liveTranscription = true;
             callback(response);
           }
         });
       } else {
         callback(customErrors.error_8001);
       }
     };
     
     that.stopLiveTranscription = (callback = () => { }) => {
       if(that.liveTranscription === true) {
         that.liveTranscription = false;
         that.socket.sendEvent('stopLiveTranscription', (response) => {
           if(response && response.result === 0) {
             callback(response);
           }
         });
       } else {
         callback(customErrors.error_8002);
       }
     };
 
     that.makeOutboundCall = (dialNumber, callerId, dialOptions, callback = () => { }) => {
         if (typeof callback === 'function') {
             const allow = !((that.subscription && (that.subscription.sip_outbound === false)));
             let options = {};
             if (dialOptions === undefined) {
                 options.silent_join = true
             } else {
                 if (dialOptions.name !== undefined) {
                     options.name = dialOptions.name;
                 }
                 if (dialOptions.early_media !== undefined && typeof dialOptions.early_media == 'boolean') {
                     //early media case 
                     options.early_media = dialOptions.early_media;
                 } else if (dialOptions.silent_join !== undefined && typeof dialOptions.silent_join == 'boolean')
                     options.silent_join = dialOptions.silent_join;
                 else
                     options.silent_join = true;
             }
             if (allow === true) {
                 if (dialNumber != null) {
                     console.log("Options: " + JSON.stringify(options));
                     that.socket.sendMessage('makeOutboundCall', { number: dialNumber, caller_id: callerId, options }, (response) => {
                         if (response && response.result === 0) {
                             that.dialOutList.set(dialNumber, { initiator: true, state: 'initiated' });
                             Logger.info(`Outbound call initiated for the number: ${dialNumber}`);
                         } else if (response && response.result === 1141) {
                             Logger.error(`Outbound call is in progress for the number: ${dialNumber}`);
                         } else {
                             Logger.info(`Received ${JSON.stringify(response)} for outbound number: ${dialNumber}`);
                         }
                         // @todo - error handling
                         if (callback) {
                             callback(response);
                         }
                     });
                 } // @todo - what happens in else condition
             } else if (!allow) {
                 if (callback) {
                     EL.error('room-event', customEvents.event_general_failed, { message: 'makeOutboundCall - not allowed' });
                     callback(customErrors.error_1170);
                 }
             }
         }
         else {
             Logger.error('makeOutboundCall() invalid param - callback');
         }
     };
 
     that.cancelOutboundCall = (dialNumber, callback) => {
         const dialState = that.dialOutList.get(dialNumber);
 
         if (dialState === undefined) {
             //This is the case where the client must have rejoined or moderator is trying to cancel the call.
             if (that.me.role === 'moderator') {
                 that.socket.sendMessage('cancelOutboundCall', { number: dialNumber }, (response) => {
                     Logger.info(`Cancel outbound call, response received is ${JSON.stringify(response)}`);
                     EL.info('room-event', customEvents.event_general_success, { message: 'cancelOutboundCall - success' });
                     if (callback) {
                         callback(response);
                     }
                 });
             } else if (callback) {
                 EL.error('room-event', customEvents.event_general_failed, { message: 'cancelOutboundCall - Insufficient Privileges' });
                 callback({ result: 1705, msg: 'Insufficient Privileges' });
             }
             return;
         }
 
         if (that.me.role === 'moderator' || dialState.initiator === true) {
             that.socket.sendMessage('cancelOutboundCall', { number: dialNumber }, (response) => {
                 Logger.info(`Cancel outbound call, response received is ${JSON.stringify(response)}`);
                 EL.info('room-event', customEvents.event_general_success, { message: 'cancelOutboundCall - success' });
                 if (callback) {
                     callback(response);
                 }
             });
         } else {
             Logger.error(' You need to be moderator or the initiator of the oubound call to disconnect the call.');
             EL.error('room-event', customEvents.event_general_failed, { message: 'cancelOutboundCall - Insufficient Privileges' });
             if (callback) {
                 callback({ result: 1705, msg: 'Insufficient Privileges' });
             }
         }
     };
 
     const onDialStateEvents = (msg) => {
         Logger.debug('recieved dialStateEvents');
         let dialState = that.dialOutList.get(msg.number);
         switch (msg.status) {
             case 'dialing':
                 if (dialState === undefined) {
                     dialState = { initiator: false, state: 'dialing' };
                     that.dialOutList.set(msg.number, dialState);
                 }
                 break;
 
             case 'proceeding':
             case 'connected':
                 dialState.state = msg.status;
                 break;
 
             case 'failed':
             case 'timeout':
             case 'disconnected':
                 that.dialOutList.delete(msg.number);
                 break;
 
             default:
                 Logger.debug('Unknown response received');
         }
         const evt = RoomEvent({ type: 'dial-state-events', message: { number: msg.number, state: msg.status, description: msg.description } });
         Logger.debug(`Dispatching dial state event: ${JSON.stringify(evt)}`);
         that.dispatchEvent(evt);
     };
 
     that.pingBack = (callback) => {
         that.socket.sendMessage('pingBack', {}, (response) => {
             if (callback) {
                 callback(response);
             }
         });
     };
 
     //Generic log method for external tools usage
     that.startClientUsage = (data, callback) => {
         that.socket.sendMessage('startClientUsage', data, (response) => {
             if (callback) {
                 callback(response);
             }
         });
     };
 
     that.stopClientUsage = (data, callback) => {
         that.socket.sendMessage('stopClientUsage', data, (response) => {
             Logger.info(`callback received ${JSON.stringify(response)}`);
             if (callback) {
                 callback(response);
             }
         });
     };
 
     /*
     * Creates the breakout room, sends the room_id and room_name in the callbacks.
     */
     that.createBreakOutRoom = (data, callback = () => { }) => {
         if (typeof callback === 'function' && typeof data === 'object' && data.hasOwnProperty('participants')) {
             if (data && data.participants > 0) {
                 that.socket.sendMessage('create-breakout-room', data, (result) => {
                     if (result) {
                         Logger.info(`Create breakout room, result: ${JSON.stringify(result)}`);
                         EL.info('room-event', customEvents.event_general_success, { message: 'createBreakOutRoom - success' });
                         callback(result);
                     }
                 });
             } else {
                 Logger.info(`Invalid value for participants ${JSON.stringify(data)}`);
                 EL.error('room-event', customEvents.event_general_failed, { message: `createBreakOutRoom - Invalid value for participants ${JSON.stringify(data)}` });
                 if (callback) {
                     callback(customErrors.error_1155);
                 }
             }
         } else {
             Logger.error('createBreakOutRoom() invalid param - callback/RoomDefinition');
         }
     };
 
     /*
     * Creates and Automatically Invites participants to the breakout room.
     * Participants are choosen automatically for the breakout room.
     */
     that.createAndInviteBreakOutRoom = (data, callback) => {
         if (data && data.max_rooms > 0) {
             data.force_join = true;
             that.socket.sendMessage('create-invite-breakout-room', data, (result) => {
                 if (result) {
                     Logger.info(`Create breakout room, result: ${JSON.stringify(result)}`);
                     EL.info('room-event', customEvents.event_general_success, { message: 'createAndInviteBreakOutRoom - success' });
                     callback(result);
                 }
             });
         } else {
             Logger.info(`Invalid value for participants ${JSON.stringify(data)}`);
             EL.error('room-event', customEvents.event_general_failed, { message: `createAndInviteBreakOutRoom - Invalid value for participants ${JSON.stringify(data)}` });
             if (callback) {
                 callback(customErrors.error_1155);
             }
         }
     };
 
     that.joinBreakOutRoom = (data, streamInfo, callback = () => { }) => {
         if (typeof callback === 'function') {
             if (data && data.room_id !== null && data.role !== null) {
                 that.socket.sendMessage('join-breakout-room', data, (resp) => {
                     if (resp && resp.result === 0) {
                         that.breakOutRoom.joinRoom(resp.token, streamInfo, (success, error) => {
                             if (success) {
                                 Logger.info(`****Join Breakout Room Success****, sending user-joined-event****${JSON.stringify(success.roomData)}`);
                                 that.socket.sendMessage('user-joined-breakout-room', { name: success.roomData.name });
                                 EL.info('room-event', customEvents.event_general_success, { message: 'joinBreakOutRoom - success' });
                                 if (callback) {
                                     callback(success, null);
                                 }
                             }
                             if (error) {
                                 EL.error('room-event', customEvents.event_general_failure, { message: 'joinBreakOutRoom - failure' });
                                 if (callback) {
                                     callback(null, error);
                                 }
                             }
                         });
                     } else {
                         Logger.error(`Invalid data, room id not found ${JSON.stringify(data)}`);
                         EL.error('room-event', customEvents.event_general_failure, { message: `joinBreakOutRoom - Invalid data, room id not found ${JSON.stringify(data)}` });
                         if (callback) {
                             callback(customErrors.error_1155);
                         }
                     }
                 });
             } else {
                 Logger.error(`Invalid data, room id not found${JSON.stringify(data)}`);
                 EL.error('room-event', customEvents.event_general_failure, { message: `joinBreakOutRoom - Invalid data, room id not found ${JSON.stringify(data)}` });
                 if (callback) {
                     callback(customErrors.error_1155);
                 }
             }
         }
         else {
             Logger.error('joinBreakoutRoom() invalid param - callback');
         }
     };
 
     that.inviteToBreakoutRoom = (data, callback = () => { }) => {
         if (typeof callback === 'function' && typeof data === 'object' && data.hasOwnProperty('room_id')) {
             if (data === undefined || data.room_id === undefined) {
                 Logger.info(`Invalid data, room id not found${JSON.stringify(data)}`);
                 EL.error('room-event', customEvents.event_general_failure,
                     { message: `inviteToBreakoutRoom - Invalid data, room id not found ${JSON.stringify(data)}` });
                 if (callback) {
                     callback(customErrors.error_1155);
                 }
                 return;
             }
             that.socket.sendMessage('invite-breakout-room', data, (result) => {
                 if (result) {
                     Logger.info(`Create breakout room, result:${JSON.stringify(result)}`);
                     EL.info('room-event', customEvents.event_general_success, { message: 'inviteToBreakoutRoom - success' });
                     if (callback) {
                         callback(result);
                     }
                 }
             });
         } else {
             Logger.error('inviteToBreakoutRoom() invalid param - callback/invitee');
         }
     };
 
     that.clearAllBreakOutSession = (callback) => {
         if (callback !== undefined && typeof callback === 'function') {
             that.breakOutRoom.disconnectAll();
             that.resumeRoom(callback);
         }
     };
 
     that.destroyAllBreakOutSession = (callback) => {
         if (that.me.role === 'moderator') {
             that.breakOutRoom.destroyAll();
             that.resumeRoom(callback);
         }
     };
 
 
     const fileUploader = async function (archive, options = { isMobile: false, broadcast: true, clientList: [] }, callback) {
         Logger.info(' init file upload ');
         const upJobId = uploadsInProgress.size;
         const fUploadResult = {
             messageType: 'upload-started',
             result: 0,
             description: 'upload started',
             response: {
                 uploadStatus: 'started',
                 upJobId,
                 uploadInfo: {
                     upJobId,
                     name: archive.name,
                     size: archive.size,
                     type: archive.type,
                 },
             },
         };
 
         try {
             const fs = new FileSender();
             const fSender = { sender: fs, status: 'started' };
             uploadsInProgress.set(upJobId, fSender);
             // fire event to app informing upload success  // to do : modify the message and keep only relevent metadata
             let evt = RoomEvent({ type: 'fs-upload-result', message: fUploadResult });
             that.dispatchEvent(evt);
             // upload the file
             const file = await fs.upload(archive);
             const sFile = file.toJSON();
 
             //update the status as complete and update the map
             fSender.status = 'completed';
             uploadsInProgress.set(upJobId, fSender);
             fUploadResult.messageType = 'upload-completed';
             fUploadResult.response.uploadStatus = fSender.status;
             fUploadResult.response.upJobId = upJobId;
             fUploadResult.description = ' upload completed';
             fUploadResult.response.uploadInfo = {
                 upJobId,
                 name: sFile.name,
                 size: sFile.size,
                 speed: sFile.speed,
                 createdAt: sFile.createdAt,
                 dlimit: sFile.dlimit,
                 time: sFile.time,
                 expiresAt: sFile.expiresAt,
                 timeLimit: sFile.timeLimit,
             };
 
             if (options.isMobile === true) {
                 Logger.info(' file sharing mobile client ');
                 fUploadResult.response.uploadInfo = sFile;
                 fUploadResult.response.uploadInfo.upJobId = upJobId;
                 evt = RoomEvent({ type: 'fs-upload-result', message: fUploadResult });
                 that.dispatchEvent(evt);
                 callback(fUploadResult);
                 return;
             }
 
             Logger.info(' is mobile  false ', options.isMobile);
             // web client send the data to signalling server
             // do we want to provide a default way to
             //allow user to append File sharing fantom UI  then this provision can be used with UI modification
             if (that.showFsUi === true && document.getElementById(fileShareUI.recvElToAppend) !== null) {
                 inFileShareUI(sFile, document.getElementById(fileShareUI.recvElToAppend), 'fs-file-uploaded');
             }
 
             that.sendFtData(sFile, 'fs-file-available', options.broadcast, options.clientList, (res) => {
                 fUploadResult.response.sentStatus = res;
                 Logger.info('sent message to all participants: file is available for download ', res, 'fupload result', fUploadResult);
                 // fire event to app informing upload success
                 // to do : modify the message and keep only relevent metadata
                 evt = RoomEvent({ type: 'fs-upload-result', message: fUploadResult });
                 that.dispatchEvent(evt);
                 callback(fUploadResult);
             });
 
             //refactor seems some error need to check why callback not returned from send ft
             // comment below event to fix duplcate message
             evt = RoomEvent({ type: 'fs-upload-result', message: fUploadResult });
             that.dispatchEvent(evt);
             EL.error('room-event', customEvents.event_file_shared_success, { error: {} });
             callback(fUploadResult);
         } catch (error) {
             Logger.info('upload to file server failed', error);
             uploadsInProgress.delete(upJobId);
             fUploadResult.messageType = 'upload-failed';
             fUploadResult.response.uploadStatus = 'failed';
             fUploadResult.description = ' upload failed';
             fUploadResult.result = 1;
             const evt = RoomEvent({ type: 'fs-upload-result', message: fUploadResult });
             that.dispatchEvent(evt);
             Logger.error('exception in file upload ', error);
             // callback sith failure code
             const result = customErrors.error_1182;
             Logger.info(' send file failed', result);
             EL.error('room-event', customEvents.event_file_shared_failed, { error: {} });
             callback(result);
         }
     };
 
     //  var callback =( res)=> {console.log('send file response ', res)};
     // (msg, broadcast, clientList, callback)
     that.sendFiles = (files = [], options = { isMobile: false, broadcast: true, clientList: [] }, callback) => {
         // sanatize the input , check if it is a proper file or not
         // upload files
         // check the sanity of files array
         Logger.info(`Send file called options ${JSON.stringify(options)} file object ${JSON.stringify(files)}`);
         if (that.state === DISCONNECTED && options.isMobile === false) {
             const result = customErrors.error_1180;
             Logger.info(' file upload: room is disconnected, file operations are not allowed');
             EL.error('room-event', customEvents.event_file_shared_failed, { message: 'file upload: room is disconnected, file operations are not allowed' });
             callback(result);
             return;
         }
 
         if (!(callback && typeof callback === 'function')) {
             var callback = (res) => {
                 Logger.info('SDK defined callback send file response ', res);
             };
         } else {
             Logger.info('send file called with callback ');
         }
 
         if (files.length > 0) {
             Logger.info('preparing to upload files');
             that.filesToUpload = files;
             try {
                 if (that.filesToUpload[that.filesToUpload.length - 1].size <= 0) {
                     Logger.info(' file size is 0 bytes ', that.filesToUpload[that.filesToUpload.length - 1].size);
                     const result = customErrors.error_1186 + that.filesToUpload[that.filesToUpload.length - 1].size;
                     callback(result);
                     return;
                 }
 
                 if (!options.isMobile) {
                     // check the size limit
                     if (that.filesToUpload[that.filesToUpload.length - 1].size > maxFileSize) {
                         Logger.info(' file upload limit exceeded. max allowed limit is ', maxFileSize);
                         const result = customErrors.error_1187 + maxFileSize;
                         callback(result);
                         return;
                     }
                     // send the signalling mesage about upload started
                     const fsMessage = {};
                     fsMessage.data = files;
 
                     // do we want to provide a default way to
                     //allow user to append File sharing fantom UI  then this provision can be used with UI modification
                     if (that.showFsUi === true && document.getElementById(fileShareUI.recvElToAppend) !== null) {
                         inFileShareUI(fsMessage, document.getElementById(fileShareUI.recvElToAppend), 'fs-upload-init');
                     }
 
                     that.sendFtData(fsMessage, 'fs-upload-started', options.broadcast, options.clientList, (res) => {
                         Logger.info(' file-upload-started sent to all participants', res);
                     });
                 }
 
                 const archive = new Archive(files);
                 fileUploader(archive, options, callback);
                 EL.info('room-event', customEvents.event_file_shared_success, { error: {} });
             } catch (error) {
                 Logger.error('exception occured in send file ', error);
                 // callback sith failure code
                 const result = customErrors.error_1182;
                 Logger.info(' send file failed', result);
                 EL.error('room-event', customEvents.event_file_shared_failed, { error: {} });
                 callback(result);
             }
         } else {
             const result = customErrors.error_1185;
             Logger.info(' input file list to upload is empty', result, ' length of file array', files.length);
             callback(result);
         }
     };
 
     that.recvFiles = async (index, options = { isMobile: false }, callback = () => { }) => {
         if (typeof callback === 'function') {
             if (that.state === DISCONNECTED && options.isMobile === false) {
                 const result = customErrors.error_1180;
                 Logger.info(' file download: room is disconnected file operations are not allowed');
                 if (callback != undefined) {
                     callback(result);
                 }
                 return;
             } else if (index > shFileList.length) {
                 const result = customErrors.error_1181;
                 Logger.info(' file download: file is not available');
                 if (callback != undefined) {
                     callback(result);
                 }
                 return;
             }
 
             const fDownloadResult = {
                 messageType: 'download-started',
                 result: 0,
                 description: 'download-started',
                 response: {
                     downloadStatus: 'started',
                     jobId: index,
                     downloadInfo: that.availableFiles[index],
                 },
             };
 
             try {
                 const fileInfo = shFileList[index];
                 // download started for file , send the fs-download-result event with data from available list of files
                 // set up file receiver
                 const url = fileInfo.url.split('#')[0];
                 const response = await fetch(url);
                 const gheder = response.headers.get('WWW-Authenticate');
                 const tempNonce = gheder.replace('send-v1 ', '');
                 const fr = new FileReceiver({
                     secretKey: fileInfo.secretKey,
                     id: fileInfo.id,
                     nonce: tempNonce,
                     requiresPassword: false,
                 });
 
                 // set the download in progress map
                 const fReceiver = {
                     receiver: fr,
                     status: 'started',
                 };
 
                 downloadsInProgress.set(index, fReceiver);
                 // fire event to app informing upload success  // to do : modify the message and keep only relevent metadata
                 let evt = RoomEvent({ type: 'fs-download-result', message: fDownloadResult });
                 that.dispatchEvent(evt);
                 // get meta and download file
                 await fr.getMetadata();
                 const resp = await fr.download(options);
                 Logger.info(' file downloaded successfully ', resp);
 
                 fReceiver.status = 'completed';
                 downloadsInProgress.set(index, fReceiver);
                 fDownloadResult.messageType = 'download-completed';
                 fDownloadResult.response.downloadStatus = fReceiver.status;
                 fDownloadResult.response.jobId = index;
                 fDownloadResult.description = ' upload completed';
                 evt = RoomEvent({ type: 'fs-download-result', message: fDownloadResult });
                 EL.info('room-event', customEvents.event_file_download_success, { error: {} });
                 that.dispatchEvent(evt);
 
                 if (callback != undefined) {
                     callback(resp);
                 }
             } catch (error) {
                 // delete the entry from download progress map
                 Logger.info(' file download failed', error);
                 downloadsInProgress.delete(index);
                 fDownloadResult.messageType = 'download-failed';
                 fDownloadResult.response.downloadStatus = 'failed';
                 fDownloadResult.description = ' download failed';
                 fDownloadResult.result = 1;// do we send 1 for failure for other SDK fails ? need to check
                 const evt = RoomEvent({ type: 'fs-download-result', message: fDownloadResult });
                 that.dispatchEvent(evt);
 
                 const result = customErrors.error_1183;
                 EL.error('room-event', customEvents.event_file_download_failed, { error: customErrors.error_1183.desc });
                 if (callback != undefined) {
                     callback(result);
                 }
             }
         } else {
             Logger.error('recvFiles() invalid param - callback');
         }
 
     };
 
     that.mobileSetAvailableFile = (dat, callback) => {
         Logger.info('mobile sdk wants to set the available file list ', dat);
         // To Do validate and sanantize to see if SDK is pushing correct values ?
         if (dat.message.type === 'fs-file-available') {
             // can further sanataze but do we need ?
             shFileList.push(dat.message);
             // mobile does not have available file list and we do not want to expose full structure
             // to do :- find a better solution to abstract this for mobile sdk user and normal open API
             const favailable = {
                 name: dat.message.name,
                 size: dat.message.size,
                 speed: dat.message.speed,
                 createdAt: dat.message.createdAt,
                 dlimit: dat.message.dlimit,
                 time: dat.message.time,
                 expiresAt: dat.message.expiresAt,
                 timeLimit: dat.message.timeLimit,
                 index: shFileList.length - 1,
             };
             that.availableFiles.push(favailable);
 
             callback(true);
         } else {
             callback(true);
         }
     };
 
     that.setFsEndPoint = (options = { isMobile: false, fsDetails: {} }) => {
         if (options.isMobile === true) {
             //    Logger.info('set filsharing service details from mobile client', JSON.stringify(options.fsDetails));
             setFileShareServiceEndPoint(options.fsDetails, options.callInfo); // pass the call info as well
         }
     };
 
     // added for testing , if needed we can extend it to provide injected UI
     that.inJectFsUI = (options = { enable: true, uploadElToAppend: '', recvElToAppend: '' }) => {
         if (options && options.enable === true && options.uploadElToAppend !== '' && document.getElementById(options.uploadElToAppend) !== null && options.recvElToAppend !== '' && document.getElementById(options.recvElToAppend) !== null) {
             Logger.info(' show file sharing UI ');
             that.showFsUi = true;
             fileShareUI.uploadElToAppend = options.uploadElToAppend;
             fileShareUI.recvElToAppend = options.recvElToAppend;
             that.testFT();
         } else {
             Logger.info(' file UI injection failed');
         }
     };
 
     that.testFT = () => {
         if ((that.showFsUi === false) || (that.showFsUi === true && document.getElementById(fileShareUI.uploadElToAppend) === null)) {
             Logger.info(' file upload  UI can not be appended');
             return;
         }
         const x = document.createElement('INPUT');
         x.setAttribute('type', 'file');
         x.setAttribute('id', 'filesID');
         //  var elToAppend = document.getElementById('chat_btn');
         const elToAppend = document.getElementById(fileShareUI.uploadElToAppend);
         elToAppend.appendChild(x);
 
         function handleFileSelect(evt) {
             const files = evt.target.files; // FileList object
             //    that.filesToUpload = files;
             // temp test for android
             //    that.sendFiles(that.filesToUpload);
             that.sendFiles(files);
             // Loop through the FileList and render image files as thumbnails.
             for (var i = 0, f; f = files[i]; i++) {
                 console.log(f);
             }
         }
 
         document.getElementById('filesID').addEventListener('change', handleFileSelect, false);
         document.getElementById('filesID').addEventListener('click', (evt) => {
             evt.target.value = null;
         }, false);
     };
 
     //room level functionality to cancel all running uploads
     that.cancelUploads = (cancelAll = false, upJobId = undefined, callback) => {
         const res = {
             description: 'failed',
             result: 1,
         };
         if (upJobId === undefined && cancelAll === false) {
             Logger.error(' upJobId must be defined for cancelling a particular upload ');
             res.description = 'upJobId is undefined.';
             res.result = 1;
             if (callback !== undefined) {
                 return callback(res);
             }
         } else if (cancelAll === true) {
             for (const [key, value] of uploadsInProgress) {
                 if (value.status === 'started') {
                     value.sender.cancel();
                     Logger.info(' running jobs are', value);
                 } else {
                     Logger.info(' status is ', value.status);
                 }
             }
             res.description = 'Cancelled all uploads';
             res.result = 0;
             if (callback !== undefined) {
                 callback(res);
             }
         } else if (upJobId != undefined) {
             Logger.info('cancelling specified upload with id', upJobId);
             const cancelUpload = uploadsInProgress.get(upJobId);
             if (cancelUpload != undefined) {
                 if (cancelUpload.status === 'started') {
                     Logger.info('canceled upload', upJobId);
                     cancelUpload.sender.cancel();
                     res.description = `Cancelled upload ${upJobId}`;
                     res.result = 0;
                     if (callback != undefined) {
                         callback(res);
                     }
                 } else if (cancelUpload.status === 'completed') {
                     Logger.info('upload can not be cancelled because it is already completed');
                     res.description = 'upload is already completed.';
                     res.result = 1;
                     if (callback != undefined) {
                         callback(res);
                     }
                 }
             } else {
                 Logger.info('Uplode id is invalid');
                 res.description = 'Uplode id is invalid. ';
                 res.result = 1;
                 if (callback != undefined) {
                     callback(res);
                 }
             }
         }
     };
 
     //room level functionality to cancel all running uploads
     that.cancelDownloads = (cancelAll = false, dJobId = undefined, callback) => {
         const res = { description: 'failed', result: 1 };
         if (dJobId === undefined && cancelAll === false) {
             Logger.error('ID must be defined for cancelling a particular upload ');
             res.description = 'ID is undefined.';
             res.result = 1;
             if (callback !== undefined) {
                 return callback(res);
             }
         } else if (cancelAll === true) {
             for (const [key, value] of downloadsInProgress) {
                 if (value.status === 'started') {
                     value.receiver.cancel();
                     Logger.info(' running jobs are', value);
                 } else {
                     Logger.info(' status is ', value.status);
                 }
             }
             res.description = 'Cancelled all downloads';
             res.result = 0;
             if (callback !== undefined) {
                 callback(res);
             }
         } else if (dJobId != undefined) {
             Logger.info('cancelling specified download with id', dJobId);
             dJobId = dJobId.toString();
             const cancelDownloadload = downloadsInProgress.get(dJobId);
             if (cancelDownloadload != undefined) {
                 if (cancelDownloadload.status === 'started') {
                     Logger.info('cancelling download', dJobId);
                     cancelDownloadload.receiver.cancel();
                     res.description = `Cancelled download ${dJobId}`;
                     res.result = 0;
                     if (callback != undefined) callback(res);
                 } else if (cancelDownloadload.status === 'completed') {
                     Logger.info('Download can not be cancelled because it is already completed');
                     res.description = 'download is already completed.';
                     res.result = 1;
                     if (callback != undefined) {
                         callback(res);
                     }
                 }
             } else {
                 Logger.info('download id is invalid');
                 res.description = 'Download id is invalid. ';
                 res.result = 1;
                 if (callback != undefined) {
                     callback(res);
                 }
             }
         }
     };
 
     // test function for mobile SDK file sharing  // remove it latter
     that.testFtMobile = (isMobile = false) => {
         const x = document.createElement('INPUT');
         x.setAttribute('type', 'file');
         x.setAttribute('id', 'files-mobile');
         let elToAppend = '';
         if (isMobile === false) {
             elToAppend = document.getElementById('chat_btn');
         } else {
             elToAppend = document.body;
         }
 
         elToAppend.appendChild(x);
 
         function handleFileSelect(evt) {
             const files = evt.target.files; // FileList object
             Logger.info('mobile list of files to upload', files[0]);
 
             that.filesToUpload = files;
             // that.sendFiles(that.filesToUpload);
 
             // Loop through the FileList and render image files as thumbnails.
             for (var i = 0, f; f = files[i]; i++) {
                 console.log('iterating file list', f);
             }
         }
 
         document.getElementById('files-mobile').addEventListener('change', handleFileSelect, false);
     };
 
     const socketOnStreamingNotification = (arg) => {
         //      Logger.debug('onstreamingnotification events' + JSON.stringify(arg));
         const evt = RoomEvent({ type: arg.type, message: arg.data });
         that.dispatchEvent(evt);
     };
     const socketOnLiveRecordingNotification = (arg) => {
         //      Logger.debug('onLiveRecordingnotification events' + JSON.stringify(arg));
         const evt = RoomEvent({ type: arg.type, message: arg.data });
         that.dispatchEvent(evt);
     };
     if (Connection.browserEngineCheck() !== 'IE') {
         //that.on('room-disconnected', clearAll);
         socket.on(VcxEvent.SocketEvent.onAddStream, socketEventToArgs.bind(null, socketOnAddStream));
         socket.on(VcxEvent.SocketEvent.media_engine_connecting, socketEventToArgs.bind(null, socketOnVcxRtcMessage));
         socket.on(VcxEvent.SocketEvent.signaling_message_peer, socketEventToArgs.bind(null, socketOnPeerMessage));
         socket.on(VcxEvent.SocketEvent.publish_me, socketEventToArgs.bind(null, socketOnPublishMe));
         socket.on(VcxEvent.SocketEvent.unpublish_me, socketEventToArgs.bind(null, socketOnUnpublishMe));
         socket.on(VcxEvent.SocketEvent.onBandwidthAlert, socketEventToArgs.bind(null, socketOnBandwidthAlert));
         socket.on(VcxEvent.SocketEvent.onBandwidthEvents, socketEventToArgs.bind(null, socketOnBandwidthEvents));
         socket.on(VcxEvent.SocketEvent.onSelfBandwidthAlert, socketEventToArgs.bind(null, socketOnSelfBandwidthAlert));
         socket.on(VcxEvent.SocketEvent.onDataStream, socketEventToArgs.bind(null, socketOnDataStream));
         socket.on(VcxEvent.SocketEvent.onUpdateAttributeStream, socketEventToArgs.bind(null, socketOnUpdateAttributeStream));
         socket.on(VcxEvent.SocketEvent.onRemoveStream, socketEventToArgs.bind(null, socketOnRemoveStream));
         socket.on(VcxEvent.SocketEvent.disconnect, socketEventToArgs.bind(null, socketOnDisconnect));
         socket.on(VcxEvent.SocketEvent.connection_failed, socketEventToArgs.bind(null, socketOnICEConnectionFailed));
         socket.on(VcxEvent.SocketEvent.error, socketEventToArgs.bind(null, socketOnError));
         socket.on(VcxEvent.SocketEvent.onRemoveTrack, socketEventToArgs.bind(null, socketOnRemoveTrack));
         socket.on(VcxEvent.SocketEvent.user_connected, socketEventToArgs.bind(null, userConnect));
         socket.on(VcxEvent.SocketEvent.user_updated, socketEventToArgs.bind(null, userUpdate));
         socket.on(VcxEvent.SocketEvent.user_disconnected, socketEventToArgs.bind(null, userDisConnect));
         socket.on(VcxEvent.SocketEvent.user_subscribed, socketEventToArgs.bind(null, userSubcribe));
         socket.on(VcxEvent.SocketEvent.user_unsubscribed, socketEventToArgs.bind(null, userUnSubcribe));
         socket.on(VcxEvent.SocketEvent.floor_management_events, socketEventToArgs.bind(null, onFloorManagementEvents));
         socket.on(VcxEvent.SocketEvent.dial_state_events, socketEventToArgs.bind(null, onDialStateEvents));
         socket.on(VcxEvent.UserEvent.user_awaited, socketEventToArgs.bind(null, onUserAwaited));
         socket.on(VcxEvent.SocketEvent.data_stream_room, socketEventToArgs.bind(null, socketOnDataStreamToRoom));
 
         socket.on(VcxEvent.RoomEvent.room_awaited, socketEventToArgs.bind(null, onRoomAwaited));
         socket.on(VcxEvent.RoomEvent.room_connected, socketEventToArgs.bind(null, onRoomConnected));
         socket.on(VcxEvent.RoomEvent.room_disconnected, socketEventToArgs.bind(null, onRoomDisconnected));
         socket.on(VcxEvent.RoomEvent.room_record_on, socketEventToArgs.bind(null, onRoomRecordStarted));
         socket.on(VcxEvent.RoomEvent.room_record_off, socketEventToArgs.bind(null, onRoomRecordStopped));
         socket.on(VcxEvent.RoomEvent.change_layout, socketEventToArgs.bind(null, onChangeLayout));
         socket.on(VcxEvent.RoomEvent.new_active_talker, socketEventToArgs.bind(null, onNewActiveTalker));
         socket.on(VcxEvent.RoomEvent.hard_mute_audio, socketEventToArgs.bind(null, onHardMuteAudio));
         socket.on(VcxEvent.RoomEvent.hard_unmute_audio, socketEventToArgs.bind(null, onHardUnmuteAudio));
         socket.on(VcxEvent.RoomEvent.hard_mute_video, socketEventToArgs.bind(null, onHardMuteVideo));
         socket.on(VcxEvent.RoomEvent.hard_unmute_video, socketEventToArgs.bind(null, onHardUnmuteVideo));
         socket.on(VcxEvent.RoomEvent.share_started, socketEventToArgs.bind(null, onShareStarted));
         socket.on(VcxEvent.RoomEvent.share_stopped, socketEventToArgs.bind(null, onShareStopped));
         socket.on(VcxEvent.RoomEvent.screen_share_override, socketEventToArgs.bind(null, onScreenShareOverride));
         socket.on(VcxEvent.RoomEvent.stop_sharing, socketEventToArgs.bind(null, onStopSharing));
         socket.on(VcxEvent.RoomEvent.update_layout, socketEventToArgs.bind(null, onUpdateLayout));
         socket.on(VcxEvent.RoomEvent.share_state_events, socketEventToArgs.bind(null, onShareStateEvents));
         socket.on(VcxEvent.RoomEvent.custom_data_saved, socketEventToArgs.bind(null, onCustomDataSaved));
         socket.on(VcxEvent.RoomEvent.custom_data_updated, socketEventToArgs.bind(null, onCustomDataUpdated));
 
         socket.on(VcxEvent.RoomEvent.canvas_started, socketEventToArgs.bind(null, onCanvasStarted));
         socket.on(VcxEvent.RoomEvent.canvas_stopped, socketEventToArgs.bind(null, onCanvasStopped));
         socket.on(VcxEvent.RoomEvent.canvas_state_events, socketEventToArgs.bind(null, onCanvasStateEvents));
 
         socket.on(VcxEvent.RoomEvent.generic_events, socketEventToArgs.bind(null, onGenericEvents));
         socket.on(VcxEvent.RoomEvent.user_role_changed, socketEventToArgs.bind(null, onUserRoleChangedEvent));
 
         socket.on(VcxEvent.RoomEvent.switch_codec, socketEventToArgs.bind(null, onSwitchCodec));
         socket.on(VcxEvent.RoomEvent.invite_breakout_room, socketEventToArgs.bind(null, onInviteBreakOutRoom));
         socket.on(VcxEvent.RoomEvent.user_joined_breakout_room, socketEventToArgs.bind(null, onUserJoinedBreakOutRoom));
         socket.on(VcxEvent.RoomEvent.user_left_breakout_room, socketEventToArgs.bind(null, onUserDisconnectedBreakOutRoom));
         socket.on(VcxEvent.RoomEvent.breakout_room_destroyed, socketEventToArgs.bind(null, onBreakOutRoomDestroyed));
         socket.on(VcxEvent.RoomEvent.transcription_events, socketEventToArgs.bind(null, onTranscriptionEvents));
 
 
         socket.on(VcxEvent.UserEvent.user_audio_muted, socketEventToArgs.bind(null, onUserAudioMuted));
         socket.on(VcxEvent.UserEvent.user_audio_unmuted, socketEventToArgs.bind(null, onUserAudioUnmuted));
         socket.on(VcxEvent.UserEvent.user_video_muted, socketEventToArgs.bind(null, onUserVideoMuted));
         socket.on(VcxEvent.UserEvent.user_video_unmuted, socketEventToArgs.bind(null, onUserVideoUnmuted));
 
         socket.on(VcxEvent.SocketEvent.room_management_events, socketEventToArgs.bind(null, onRoomManagementEvents));
         socket.on(VcxEvent.SocketEvent.hard_mute, socketEventToArgs.bind(null, onHardmuteOne));
         socket.on(VcxEvent.SocketEvent.hard_mute_room, socketEventToArgs.bind(null, onHardmuteRoom));
         socket.on(VcxEvent.SocketEvent.hard_unmute_room, socketEventToArgs.bind(null, onHardUnmuteRoom));
         socket.on(VcxEvent.SocketEvent.onStatSubscription, socketEventToArgs.bind(null, socketOnStatSubscription));
         socket.on(VcxEvent.SocketEvent.onStreamingNotification, socketEventToArgs.bind(null, socketOnStreamingNotification));
         socket.on(VcxEvent.SocketEvent.onLiveRecordingNotification, socketEventToArgs.bind(null, socketOnLiveRecordingNotification));
         socket.on(VcxEvent.SocketEvent.onRoomLiveRecordingOn, socketEventToArgs.bind(null, onRoomLiveRecordStarted));
         socket.on(VcxEvent.SocketEvent.onRoomLiveRecordingOff, socketEventToArgs.bind(null, onRoomLiveRecordStopped));
         socket.on(VcxEvent.SocketEvent.onRoomLiveRecordingFailed, socketEventToArgs.bind(null, onRoomLiveRecordFailed));
         //Switched room changes
         socket.on(VcxEvent.SocketEvent.switched_room, socketEventToArgs.bind(null, onRoomSwitched));
     } else {
         if (document.getElementById('WebrtcEverywherePluginId') === null) {
             that.installPlugin();
         }
         const plugin = document.getElementById('WebrtcEverywherePluginId');
 
         plugin.addEventListener(VcxEvent.SocketEvent.onAddStream, (event) => {
             for (arg in event.data.args) {
                 socketOnAddStream(event.data.args[arg]);
             }
         });
         plugin.addEventListener(VcxEvent.SocketEvent.onRemoveStream, (event) => {
             for (arg in event.data.args) {
                 socketOnRemoveStream(event.data.args[arg]);
             }
         });
         plugin.addEventListener(VcxEvent.SocketEvent.media_engine_connecting, (event) => {
             for (arg in event.data.args) {
                 socketOnVcxRtcMessage(event.data.args[arg]);
             }
         });
         plugin.addEventListener(VcxEvent.SocketEvent.publish_me, (event) => {
             for (arg in event.data.args) {
                 socketOnPublishMe(event.data.args[arg]);
             }
         });
         plugin.addEventListener(VcxEvent.SocketEvent.user_connected, (event) => {
             for (arg in event.data.args) { userConnect(event.data.args[arg]); }
         });
         plugin.addEventListener(VcxEvent.SocketEvent.user_disconnected, (event) => {
             for (arg in event.data.args) {
                 userDisConnect(event.data.args[arg]);
             }
         });
         plugin.addEventListener(VcxEvent.SocketEvent.user_subscribed, (event) => {
             for (arg in event.data.args) {
                 userSubcribe(event.data.args[arg]);
             }
         });
         plugin.addEventListener(VcxEvent.SocketEvent.user_unsubscribed, (event) => {
             for (arg in event.data.args) {
                 userUnSubcribe(event.data.args[arg]);
             }
         });
     }
     return that;
 };
 
 export default Room;
 