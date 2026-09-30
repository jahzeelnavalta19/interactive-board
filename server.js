const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public', {
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'ib-host.html')); });

let interactiveBoards = {};

function generateCode(){return Math.floor(1000+Math.random()*9000).toString();}

io.on('connection',(socket)=>{
  console.log('Connected: '+socket.id);

  // ===== INTERACTIVE BOARD =====
  socket.on('ib-create',(data)=>{
    const pin=generateCode();
    if(interactiveBoards[pin]){socket.emit('ib-created',{pin:generateCode()});return;}
    const numGroups=data.numGroups||4;
    const groups={};
    for(let i=1;i<=numGroups;i++){groups[i]={name:'Group '+i,score:0,answer:'',submitted:false,judged:null};}
    interactiveBoards[pin]={
      hostSocket:socket,
      groups:groups,
      section:data.section||'11-TAURUS',
      numGroups:numGroups,
      currentQuestion:0,
      questionActive:false,
      points:1,
      timeLimit:30,
      questionStartTime:null
    };
    socket.join(`ib-host-${pin}`);
    socket.gamePIN=pin;
    socket.isIbHost=true;
    socket.emit('ib-created',{pin,section:data.section,numGroups:numGroups,groups:groups});
    console.log('IB Session created: '+pin);
  });

  socket.on('ib-join',(data)=>{
    const{pin,groupNum}=data;
    if(!interactiveBoards[pin]){socket.emit('ib-join-error',{message:'Session not found!'});return;}
    socket.join(`ib-${pin}`);
    socket.gamePIN=pin;
    socket.isIbPlayer=true;
    socket.ibGroupNum=parseInt(groupNum);
    socket.emit('ib-join-success',{pin,groupNum:parseInt(groupNum)});
    io.to(`ib-host-${pin}`).emit('ib-groups-update',{groups:interactiveBoards[pin].groups});
    console.log('Group '+groupNum+' joined '+pin);
  });

  socket.on('ib-start-question',(data)=>{
    const pin=socket.gamePIN;
    if(!pin||!interactiveBoards[pin])return;
    const g=interactiveBoards[pin];
    g.points=data.points||1;
    g.timeLimit=data.timeLimit||30;
    g.questionActive=true;
    g.questionStartTime=Date.now();
    Object.keys(g.groups).forEach(num=>{
      g.groups[num].answer='';
      g.groups[num].submitted=false;
      g.groups[num].judged=null;
    });
    io.to(`ib-${pin}`).emit('ib-question-start',{points:g.points,timeLimit:g.timeLimit});
    io.to(`ib-host-${pin}`).emit('ib-question-started',{points:g.points,timeLimit:g.timeLimit});
    setTimeout(()=>{
      if(g.questionActive){
        g.questionActive=false;
        io.to(`ib-${pin}`).emit('ib-time-up');
        io.to(`ib-host-${pin}`).emit('ib-time-up');
      }
    },g.timeLimit*1000);
  });

  socket.on('ib-submit-answer',(data)=>{
    const pin=socket.gamePIN;
    if(!pin||!interactiveBoards[pin])return;
    const g=interactiveBoards[pin];
    const num=socket.ibGroupNum;
    if(!num||!g.groups[num])return;
    g.groups[num].answer=data.answer;
    g.groups[num].submitted=true;
    io.to(`ib-host-${pin}`).emit('ib-answer-received',{groupNum:num,answer:data.answer,groups:g.groups});
    socket.emit('ib-answer-submitted');
  });

  socket.on('ib-judge',(data)=>{
    const pin=socket.gamePIN;
    if(!pin||!interactiveBoards[pin])return;
    const g=interactiveBoards[pin];
    const num=data.groupNum;
    if(!g.groups[num])return;
    g.groups[num].judged=data.correct;
    if(data.correct){g.groups[num].score+=g.points;}
    io.to(`ib-host-${pin}`).emit('ib-judged',{groupNum:num,correct:data.correct,groups:g.groups});
    io.to(`ib-${pin}`).emit('ib-judged-player',{groupNum:num,correct:data.correct});
  });

  socket.on('ib-next-question',()=>{
    const pin=socket.gamePIN;
    if(!pin||!interactiveBoards[pin])return;
    const g=interactiveBoards[pin];
    g.currentQuestion++;
    g.questionActive=false;
    Object.keys(g.groups).forEach(num=>{
      g.groups[num].answer='';
      g.groups[num].submitted=false;
      g.groups[num].judged=null;
    });
    io.to(`ib-host-${pin}`).emit('ib-ready-next',{groups:g.groups,questionNumber:g.currentQuestion+1});
    io.to(`ib-${pin}`).emit('ib-ready-next-player');
  });

  socket.on('ib-end-game',()=>{
    const pin=socket.gamePIN;
    if(!pin||!interactiveBoards[pin])return;
    const g=interactiveBoards[pin];
    const leaderboard=Object.entries(g.groups)
      .map(([num,grp])=>({groupNum:parseInt(num),name:grp.name,score:grp.score}))
      .sort((a,b)=>b.score-a.score);
    io.to(`ib-host-${pin}`).emit('ib-game-ended',{leaderboard});
    io.to(`ib-${pin}`).emit('ib-game-ended',{leaderboard});
  });

  socket.on('disconnect',()=>{
    const gc=socket.gamePIN;
    if(gc&&interactiveBoards[gc]){
      if(socket.isIbHost){
        io.to(`ib-${gc}`).emit('ib-host-disconnected');
        delete interactiveBoards[gc];
      }
    }
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,'0.0.0.0',()=>console.log(`Interactive Board on port ${PORT}`));