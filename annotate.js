
'use strict';
const Annotate = {
  isAnnotationStarted: false,
  canvasOptions: { width: 720, height: 621 },
  annotationConfig: {
    toolType: 'draw',
    isErase: false,
    drawMethod: 'pencil',
    strokeColor: '#ff0000',
    lineWidth: 3,
    hasInput: false,
    lastMouseX: 0,
    lastMouseY: 0,
    canvasX: 0,
    canvasY: 0,
    mouseX: 0,
    mouseY: 0,
    mouseDown: false,
    drawElement: null,
    drawCtx: null,
    canvasDomID: null,
    canvasVideoPlayerID: null,
    customCanvasID: 'draw_veneer2',
    customframeID: 'draw_frame',
    t:0,
    videoPlaying: false,
    streamid:0
    
  },

  setupAnnotationToolbar() {
    const toolbarCont = document.createElement('div');
    toolbarCont.setAttribute('id', 'annotationToolbarContainer');
    toolbarCont.style = 'position: fixed;bottom: 0; z-index: 98;';
    const toolbar = document.createElement('div');
    toolbar.setAttribute('id', 'toolbar');
    toolbar.innerHTML = `<div class="atn-btns">
      <button id="annotate-draw">Draw</button>
      <select id="selDrawMethod">
        <option value="pencil" selected="selected">Pencil</option>
        <option value="text">Text</option>
      </select>
      <input
      type="color"
      id="favcolor"
      name="favcolor"
      value="#ff0000"
      
    />
    <select id="selWidth" >
      <option value="1">1</option>
      <option value="3" selected="selected">3</option>
      <option value="5">5</option>
      <option value="7">7</option>
      <option value="9">9</option>
      <option value="11">11</option>
    </select>
    <input type="button" id="eraseBtn" value="Erase"  />
    <input type="button" id="clearBtn" value="Clear"  />
    <input type="button" id="play" value="Play-Pause" />
    
      </div>`;
    toolbarCont.append(toolbar);
    
    // this.bindEventListernersForTools()
    return { toolbarCont, toolbar };
  },
  _QS(domSelector, all = false) {
    if (all) {
      return document.querySelectorAll(`${domSelector}`) ? document.querySelectorAll(`${domSelector}`) : false;
    }
    return document.querySelector(`${domSelector}`) ? document.querySelector(`${domSelector}`) : false;


  },
  bindEventListernersForTools() {
    let _this = this;
    if (_this._QS('#annotate-draw')) {
      _this._QS('#annotate-draw').addEventListener("click", (e) => {
        _this.annotateToolAction('tool', 'draw')
      })
    }
    if (_this._QS('#selDrawMethod')) {
      _this._QS('#selDrawMethod').addEventListener("change", (e) => {
        _this.annotateToolAction('drawMethod', e.target.value)
      })
    }
    if (_this._QS('#selWidth')) {
      _this._QS('#selWidth').addEventListener("change", (e) => {
        _this.annotateToolAction('lineWidth', e.target.value)
      })
    }
    if (_this._QS('#favcolor')) {
      _this._QS('#favcolor').addEventListener("change", (e) => {
        _this.annotateToolAction('strokeColor', e.target.value)
      })
    }
    if (_this._QS('#eraseBtn')) {
      _this._QS('#eraseBtn').addEventListener("click", (e) => {
        _this.annotateToolAction('erase')
      })
    }
    if (_this._QS('#clearBtn')) {
      _this._QS('#clearBtn').addEventListener("click", (e) => {
        _this.annotateToolAction('clear')
      })
    }
    if (_this._QS('#play')) {
      _this._QS('#play').addEventListener("click", (e) => {
        _this.pause_play()
      })
    }
    
  },

  annotateAddInput(x, y) {
    let _this = this;
    const input = document.createElement('input');
    input.className = 'annotate-text';
    input.type = 'text';
    input.style.position = 'fixed';
    input.style.zIndex = 50;
    input.style.left = `${x - 4}px`;
    input.style.top = `${y - 4}px`;
    input.onkeydown = function (e) {
      const keyCode = e.keyCode;
      if (keyCode === 13) {
        _this.annotateDrawText(e.target.value);
        document.body.removeChild(e.target);
        _this.annotationConfig.hasInput = false;
      } else if (keyCode === 27) {
        document.body.removeChild(e.target);
        _this.annotationConfig.hasInput = false;
      }
    };
    document.body.appendChild(input);
    input.focus();
    this.annotationConfig.hasInput = true;
  },
  pause_play(){
    let _this = this;
    if(_this.annotationConfig.videoPlaying)
    {
       clearTimeout(_this.annotationConfig.t);
       _this.annotationConfig.videoPlaying = false;
       console.log("Paused !!!");
       console.log(_this.annotationConfig.t);
    }
    else{
       
      var vele = document.getElementById(`stream${_this.annotationConfig.streamid}`);
      console.log(_this.annotationConfig.streamid);
      var can = document.getElementById('draw_frame');
      var canContext = can.getContext('2d');
      (function loop (){
        canContext.drawImage(vele,0,0,720,621);
        _this.annotationConfig.t= setTimeout(loop, 0.2);
      } )();
      _this.annotationConfig.videoPlaying = true;
      console.log("playing");
      console.log(_this.annotationConfig.t);

    }
  },

  handleEnter(e) {
    let _this = this;
    const keyCode = e.keyCode;
    if (keyCode === 13) {
      _this.annotateDrawText(e.target.value);
      document.body.removeChild(e.target);
      _this.annotationConfig.hasInput = false;
    } else if (keyCode === 27) {
      document.body.removeChild(e.target);
      _this.annotationConfig.hasInput = false;
    }
  },

  annotateDrawText(txt) {
    let _this = this;
    _this.annotationConfig.drawCtx.textBaseline = 'top';
    _this.annotationConfig.drawCtx.textAlign = 'left';
    _this.annotationConfig.drawCtx.fillStyle = _this.annotationConfig.strokeColor;
    _this.annotationConfig.drawCtx.font = '14px sans-serif';
    _this.annotationConfig.drawCtx.fillText(
      txt,
      _this.annotationConfig.lastMouseX - 4,
      _this.annotationConfig.lastMouseY - 4,
    );
  },

  reOffset(selector) {
    let _this = this;
    const canvasData = selector.getBoundingClientRect();
    _this.annotationConfig.canvasX = canvasData.left;
    _this.annotationConfig.canvasY = canvasData.top;
  },
  startAgain(){
    let _this = this;
    _this.annotationConfig.videoPlaying = false;
  },

  toolBarAction(action, value) {
    let _this = this;
    if (action === 'tool') {
      _this.annotationConfig.toolType = value;
      _this.annotationConfig.isErase = false;
    } else if (action === 'erase') {
      _this.annotationConfig.toolType = action;
      _this.annotationConfig.isErase = true;
    } else if (action === 'strokeColor') {
      _this.annotationConfig.strokeColor = value;
    } else if (action === 'lineWidth') {
      _this.annotationConfig.lineWidth = value;
    } else if (action === 'drawMethod') {
      _this.annotationConfig.drawMethod = value;
    } else if (action === 'clear') {
      const elements = document.getElementsByClassName('annotate-text');
      while (elements.length > 0) {
        elements[0].remove();
      }
      _this.annotationConfig.drawCtx.clearRect(
        0,
        0,
        _this.canvasOptions.width,
        _this.canvasOptions.height,
      );
    }
  },

  appendCustomCanvas(wrapper, className, width, height) {
    let _this = this;
    _this.canvasOptions.width = width;
    _this.canvasOptions.height = height;
    const drawcanvas = document.createElement('canvas');
    drawcanvas.id = _this.annotationConfig.customCanvasID;
    drawcanvas.width = width;
    drawcanvas.height = height;
    drawcanvas.className = className;
    drawcanvas.setAttribute('style', 'display:block; user-select: none;z-index:5000; position:absolute;top:0%');
    wrapper.append(drawcanvas);
    const { toolbarCont, toolbar } = _this.setupAnnotationToolbar();
    wrapper.append(toolbarCont);

  },
  appendCanvasFrame(wrapper,className,stream) {
    let _this = this;
    _this.canvasOptions.width = 760;
    _this.canvasOptions.height = 621;
    const drawcanvas2 = document.createElement('canvas');
    const ctx = drawcanvas2.getContext('2d');
    drawcanvas2.id = _this.annotationConfig.customframeID;
    drawcanvas2.width = 760;
    drawcanvas2.height = 621;
    const stream_iD = stream.getID();
    _this.annotationConfig.streamid = stream_iD;
    const canvas_video_player2 = document.getElementById(`stream${stream_iD}`);
    drawcanvas2.className = className;
    drawcanvas2.setAttribute('style', 'display:block; user-select: none;z-index:0; position:absolute;top:0%');
    wrapper.append(drawcanvas2);
    // var videoEle = canvas_video_player2;
    // (function loop() {
    //     ctx.drawImage(videoEle,0,0,720,621);
    //     _this.annotationConfig.t= setTimeout(loop, 0.2);
       
    //  })();
     console.log(_this.annotationConfig.t);
   

  },
 



  onDown(e, touch) {
    let _this = this;

    e.preventDefault();
    var clientX, clientY;
    if (e.type == 'touchstart' || e.type == 'touchmove' || e.type == 'touchend' || e.type == 'touchcancel') {
      var evt = (typeof e.originalEvent === 'undefined') ? e : e.originalEvent;
      var touch = evt.touches[0] || evt.changedTouches[0];
      clientX = touch.pageX;
      clientY = touch.pageY;
    } else if (e.type == 'mousedown' || e.type == 'mouseup' || e.type == 'mousemove' || e.type == 'mouseover' || e.type == 'mouseout' || e.type == 'mouseenter' || e.type == 'mouseleave') {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    _this.reOffset(_this.annotationConfig.drawElement);
    _this.annotationConfig.lastMouseX = _this.annotationConfig.mouseX = parseInt(clientX - _this.annotationConfig.canvasX);
    _this.annotationConfig.lastMouseY = _this.annotationConfig.mouseY = parseInt(clientY - _this.annotationConfig.canvasY);
    _this.annotationConfig.mouseDown = true;
    if (
      _this.annotationConfig.drawMethod === 'text' &&
      _this.annotationConfig.toolType === 'draw'
    ) {
      _this.annotateAddInput(clientX, clientY);
    }
  },

  onMove(e, inputContext, touch) {
    let _this = this;
    e.preventDefault();
    var clientX, clientY;
    if (e.type == 'touchstart' || e.type == 'touchmove' || e.type == 'touchend' || e.type == 'touchcancel') {
      var evt = (typeof e.originalEvent === 'undefined') ? e : e.originalEvent;
      var touch = evt.touches[0] || evt.changedTouches[0];
      clientX = touch.pageX;
      clientY = touch.pageY;
    } else if (e.type == 'mousedown' || e.type == 'mouseup' || e.type == 'mousemove' || e.type == 'mouseover' || e.type == 'mouseout' || e.type == 'mouseenter' || e.type == 'mouseleave') {
      clientX = e.clientX;
      clientY = e.clientY;
    }


    _this.annotationConfig.mouseX = parseInt(clientX - _this.annotationConfig.canvasX);
    _this.annotationConfig.mouseY = parseInt(clientY - _this.annotationConfig.canvasY);

    if (_this.annotationConfig.mouseDown && _this.annotationConfig.drawMethod === 'pencil') {

      _this.annotationConfig.drawCtx.beginPath();
      if (_this.annotationConfig.toolType === 'draw') {
        _this.annotationConfig.drawCtx.globalCompositeOperation = 'source-over';
        _this.annotationConfig.drawCtx.strokeStyle = _this.annotationConfig.strokeColor;
        _this.annotationConfig.drawCtx.lineWidth = _this.annotationConfig.lineWidth;
      } else {
        _this.annotationConfig.drawCtx.globalCompositeOperation = 'destination-out';
        _this.annotationConfig.drawCtx.lineWidth = 10;
      }

      _this.annotationConfig.drawCtx.moveTo(
        _this.annotationConfig.lastMouseX,
        _this.annotationConfig.lastMouseY,
      );
      _this.annotationConfig.drawCtx.lineTo(
        _this.annotationConfig.mouseX,
        _this.annotationConfig.mouseY,
      );
      _this.annotationConfig.drawCtx.lineJoin = inputContext.lineCap = 'round';
      _this.annotationConfig.drawCtx.stroke();
    }
    _this.annotationConfig.lastMouseX = _this.annotationConfig.mouseX;
    _this.annotationConfig.lastMouseY = _this.annotationConfig.mouseY;
  },

  onUp(e) {
    e.preventDefault();
    this.annotationConfig.mouseDown = false;
  },

  annotateToolAction(action, value) {
    this.toolBarAction(action, value);
  },

  /*Draw on mouse move*/
  mouseAnnotate(canvasDomID, inputContext, canvasVideoPlayerID, stream = null) {
    let _this = this;
    if (stream) {
      _this.stream = stream;
    }
    _this.isAnnotationStarted = true;
    _this.annotationConfig.drawElement = document.getElementById(_this.annotationConfig.customCanvasID);
    _this.annotationConfig.drawCtx = _this.annotationConfig.drawElement.getContext('2d');
    _this.annotationConfig.canvasDomID = canvasDomID;
    _this.annotationConfig.canvasVideoPlayerID = canvasVideoPlayerID;

    //on onmousedown
    _this.annotationConfig.drawElement.addEventListener('mousedown', (e) => {
      _this.onDown(e, false);

    });
    _this.annotationConfig.drawElement.addEventListener('touchstart', (e) => {
      _this.onDown(e, true);
    });

    //on onmousemove
    _this.annotationConfig.drawElement.addEventListener('mousemove', (e) => {
      _this.onMove(e, inputContext, false);
    });
    _this.annotationConfig.drawElement.addEventListener('touchmove', (e) => {
      _this.onMove(e, inputContext, true);
    });

    //on mouseup
    _this.annotationConfig.drawElement.addEventListener('mouseup', (e) => {
      _this.onUp(e);
    });
    _this.annotationConfig.drawElement.addEventListener('touchcancel', (e) => {
      _this.onUp(e);
    });
    return _this.annotationConfig.drawElement;
  },

  stopAnnotation() {
    let _this = this;
    _this.isAnnotationStarted = false;
    const canvasWrapper = document.getElementById('canvas-wrapper');
    if (canvasWrapper) canvasWrapper.remove();
    const elements = document.getElementsByClassName('annotate-text');
    while (elements.length > 0) {
      elements[0].remove();
    }
    const annotateDiv = document.querySelector('.annotate-div');
    const annotateDivParent = annotateDiv.parentElement;
    annotateDivParent.prepend(annotateDiv.firstElementChild);
    annotateDivParent.firstChild.style.height = `100%`;
    annotateDivParent.firstChild.style.width = `100%`
    annotateDiv.remove();
    _this.annotationConfig.toolType = 'draw';
    _this.annotationConfig.isErase = false;
    _this.annotationConfig.drawMethod = 'pencil';
    _this.annotationConfig.strokeColor = '#ff0000';
    _this.annotationConfig.lineWidth = 3;
  },

  // resize() function set canvas height and width according to stream size 
  // and height , width of canvas is decreased and increased in correct aspect ratio.

  resize() {
    let _this = this;
    if (_this.isAnnotationStarted) {
      setTimeout(() => {
        const stream = _this.stream;
        if (stream) {
          var streamId = stream.getID();
          var streamVeneerCanvas = document.getElementById(`stream${streamId}_veneer`);
          var drawVeneerCanvas = document.getElementById(`draw_veneer2`);
          if (drawVeneerCanvas) {
            var canvas = drawVeneerCanvas.getContext("2d");
            var imageData = canvas.getImageData(0, 0, drawVeneerCanvas.width, drawVeneerCanvas.height);
            var track = stream.stream.getVideoTracks()[0];
            var { height, width } = track.getSettings() ? track.getSettings() : track.getConstraints();
            var annotateScreen = document.querySelector(`.annotate-div`);
            var playerDiv = document.querySelector(`#player_${streamId}`);
            var annotateHeight = annotateScreen.clientHeight;
            var annotateWidth = annotateScreen.clientWidth;
            if (annotateHeight < annotateWidth) {
              var ratio = annotateHeight / height;
              var increasedHeight = height * ratio;
              var increasedWidth = width * ratio
              if (increasedWidth > annotateWidth) {
                ratio = annotateWidth / width;
                height = height * ratio;
                width = width * ratio;
              } else {
                height = increasedHeight;
                width = increasedWidth;
              }
            } else {
              var ratio = annotateWidth / width;
              var increasedHeight = height * ratio;
              var increasedWidth = width * ratio;
              if (increasedHeight > annotateHeight) {
                ratio = annotateHeight / height;
                height = height * ratio;
                width = width * ratio;
              } else {
                height = increasedHeight;
                width = increasedWidth;
              }
            }

            playerDiv.style.height = `${height}px`;
            playerDiv.style.width = `${width}px`;
            streamVeneerCanvas.width = width;
            streamVeneerCanvas.height = height;
            drawVeneerCanvas.width = width;
            drawVeneerCanvas.height = height;
            createImageBitmap(imageData).then(function (imgBitmap) {
              canvas.drawImage(imgBitmap, 0, 0, width, height);
            })
            _this.canvasOptions.width = width;
            _this.canvasOptions.height = height;
            _this.reOffset(_this.annotationConfig.drawElement);
          }
        }
      }, 100);
    }
  }
}

// window.addeventlistener is commented because it is handled from UI side with advanced resize 

// window.addEventListener('resize', function () {
//   Annotate.resize();
// });

export default Annotate;
