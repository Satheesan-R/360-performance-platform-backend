const { test } = require('node:test');
const assert = require('node:assert/strict');
const Ticket = require('../src/modules/support/models/supportticket');
const Membership = require('../src/modules/support/models/supportmembership');
const Rate = require('../src/modules/support/models/supportrate');
const User = require('../src/modules/auth/models/usermodel');
const service = require('../src/modules/support/services/supportservice');
const access = require('../src/modules/support/services/access');
const notifications = require('../src/modules/support/services/notifications');
const mail = require('../src/services/mailservice');
const validation = require('../src/modules/support/services/validation');
const requester = '507f1f77bcf86cd799439011', officer = '507f1f77bcf86cd799439012', org = '507f1f77bcf86cd799439013', otherOrg = '507f1f77bcf86cd799439014';
const input = (key='request-identifier-0001') => ({ category:'LOGIN_PASSWORD',subject:'Cannot sign in today',description:'My browser displays an access error when I try to open the dashboard.',requestId:key });
const chain = value => ({select(){return this;},populate(){return this;},sort(){return this;},skip(){return this;},limit(){return this;},lean:async()=>value});
function fixture(t) {
  const tickets=[]; const counts=new Map();
  const actor={user:{_id:requester,role:'employee',status:'active'},organization:{_id:org},queues:[]};
  const matches=(item,filter)=>Object.entries(filter).every(([key,value])=>value && value.$in ? value.$in.includes(item[key]) : String(item[key])===String(value));
  t.mock.method(access,'actor',async()=>actor);
  t.mock.method(Rate,'findOneAndUpdate',async filter=>{const count=(counts.get(filter._id)||0)+1;counts.set(filter._id,count);return {count};});
  t.mock.method(Ticket,'findOne',filter=>chain(tickets.find(item=>matches(item,filter))||null));
  t.mock.method(Ticket,'find',filter=>chain(tickets.filter(item=>matches(item,filter))));
  t.mock.method(Ticket,'create',async data=>{
    if(tickets.some(item=>item.duplicateKey===data.duplicateKey || (item.requestId===data.requestId && String(item.requester)===String(data.requester))))throw Object.assign(Error('Duplicate'),{code:11000});
    const ticket=new Ticket(data).toObject();ticket.createdAt=new Date();ticket.updatedAt=new Date();tickets.push(ticket);return ticket;
  });
  // Explicit compare-and-swap semantics for all service mutations.
  t.mock.method(Ticket,'findOneAndUpdate',(filter,update)=>({lean:async()=>{
    const ticket=tickets.find(item=>matches(item,filter));if(!ticket)return null;
    Object.assign(ticket,update.$set);ticket.revision+=update.$inc.revision;ticket.updatedAt=new Date();
    for(const [key,value] of Object.entries(update.$push))ticket[key].push({...value,_id:'event-'+ticket[key].length});
    return ticket;
  }}));
  const notify=t.mock.method(notifications,'notify',async()=>({status:'unavailable',message:'Automatic notifications unavailable.'}));
  return {actor,tickets,counts,notify};
}
const auth={id:requester,role:'employee'};

test('creates a scoped ticket with backend routing, identifiers, timestamps and audit history',async t=>{
  const f=fixture(t);const result=await service.create(auth,input());
  assert.match(result.ticket.number,/^SUP-[A-F0-9]{16}$/);assert.equal(result.ticket.queue,'IT');assert.equal(result.ticket.status,'OPEN');assert.equal(result.ticket.priority,'NORMAL');
  assert.equal(String(f.tickets[0].requester),requester);assert.equal(String(f.tickets[0].organizationId),org);assert.ok(result.ticket.createdAt instanceof Date);assert.equal(result.ticket.history[0].action,'CREATED');
  assert.equal(f.notify.mock.calls[0].arguments[1],'queue');assert.equal(result.notification.status,'unavailable');
  for(const field of ['status','priority','assignee','requester','organizationId'])await assert.rejects(service.create(auth,{...input(),[field]:'attacker'}),{statusCode:400});
});
test('validates subjects, descriptions, categories, identifiers and obvious credential disclosures',async t=>{
  fixture(t);
  for(const body of [{subject:'bad'},{description:'short'},{category:'OTHER'},{requestId:'bad'},{description:'password=SecretValue123 do not store this in a ticket'}])await assert.rejects(service.create(auth,{...input(),...body}),{statusCode:400});
  assert.equal(validation.route('PROFILE_INFORMATION'),'HR');for(const category of ['LOGIN_PASSWORD','ACCESS_PERMISSIONS','MFA_SECURITY','OTHER_ACCOUNT'])assert.equal(validation.route(category),'IT');
  const previous=process.env.SUPPORT_PROFILE_QUEUE;process.env.SUPPORT_PROFILE_QUEUE='IT';t.after(()=>{if(previous===undefined)delete process.env.SUPPORT_PROFILE_QUEUE;else process.env.SUPPORT_PROFILE_QUEUE=previous;});assert.equal(validation.route('PROFILE_INFORMATION'),'IT');
});
test('idempotent retries and notification failure never create duplicate requests; excessive requests are limited',async t=>{
  const f=fixture(t); f.notify.mock.mockImplementation(async()=>({status:'failed',message:'Saved; mail failed.'}));
  await service.create(auth,input());const repeated=await service.create(auth,input());assert.equal(repeated.replayed,true);assert.equal(f.tickets.length,1);assert.equal(f.notify.mock.callCount(),1);
  await assert.rejects(service.create(auth,{...input(),subject:'Changed subject content'}),{statusCode:409});
  await assert.rejects(service.create(auth,input('request-identifier-0002')),{statusCode:409});
  for(let i=3;i<6;i++)await service.create(auth,{...input('request-identifier-000'+i),subject:'Separate issue '+i});
  await assert.rejects(service.create(auth,{...input('request-identifier-0006'),subject:'Separate issue 6'}),{statusCode:429});
});
test('requester ownership, queue access, and organization scoping deny unrelated tickets',async t=>{
  const f=fixture(t);const result=await service.create(auth,input());
  f.actor.user._id=officer;
  await assert.rejects(service.get(auth,result.ticket.id),{statusCode:404});await assert.rejects(service.list(auth,{scope:'queue'}),{statusCode:403});
  f.actor.queues=['HR'];await assert.rejects(service.get(auth,result.ticket.id),{statusCode:404});await assert.rejects(service.list(auth,{scope:'queue',queue:'IT'}),{statusCode:403});
  f.actor.queues=['IT'];assert.equal((await service.get(auth,result.ticket.id)).ticket.canManage,true);
  f.actor.organization._id=otherOrg;await assert.rejects(service.get(auth,result.ticket.id),{statusCode:404});
});
test('status transitions require support authorization and resolution notes, and record immutable history',async t=>{
  const f=fixture(t);const {ticket}=await service.create(auth,input());
  await assert.rejects(service.mutate(auth,ticket.id,'STATUS_CHANGED',{status:'RESOLVED',note:'Fixed this issue'}),{statusCode:403});
  f.actor.user._id=officer;f.actor.queues=['IT'];
  await assert.rejects(service.mutate(auth,ticket.id,'STATUS_CHANGED',{status:'CLOSED',note:'Close immediately'}),{statusCode:409});
  await service.mutate(auth,ticket.id,'STATUS_CHANGED',{status:'IN_PROGRESS'});
  await assert.rejects(service.mutate(auth,ticket.id,'STATUS_CHANGED',{status:'RESOLVED',note:''}),{statusCode:400});
  const result=await service.mutate(auth,ticket.id,'STATUS_CHANGED',{status:'RESOLVED',note:'Verified account access after investigation.'});
  assert.ok(result.ticket.resolvedAt instanceof Date);assert.equal(result.ticket.history.at(-1).to,'RESOLVED');assert.equal(String(f.tickets[0].history.at(-1).actor),officer);
  await service.mutate(auth,ticket.id,'STATUS_CHANGED',{status:'CLOSED',note:'Resolution confirmed by employee.'});
  await assert.rejects(service.mutate(auth,ticket.id,'STATUS_CHANGED',{status:'OPEN'}),{statusCode:409});
});
test('messages notify the requester or queue and a waiting response resumes investigation',async t=>{
  const f=fixture(t);const {ticket}=await service.create(auth,input());f.actor.user._id=officer;f.actor.queues=['IT'];
  await service.mutate(auth,ticket.id,'STATUS_CHANGED',{status:'IN_PROGRESS'});await service.mutate(auth,ticket.id,'STATUS_CHANGED',{status:'WAITING_FOR_USER'});
  await service.mutate(auth,ticket.id,'MESSAGE',{text:'Please confirm the displayed browser error.'});assert.equal(f.notify.mock.calls.at(-1).arguments[1],'requester');
  f.actor.user._id=requester;f.actor.queues=[];
  const result=await service.mutate(auth,ticket.id,'MESSAGE',{text:'The error states that my access is unavailable.'});
  assert.equal(result.ticket.status,'IN_PROGRESS');assert.equal(result.ticket.messages.length,2);assert.equal(f.notify.mock.calls.at(-1).arguments[1],'queue');
  await assert.rejects(service.mutate(auth,ticket.id,'MESSAGE',{text:'Valid text',author:officer}),{statusCode:400});
});
test('only the owner reopens resolved tickets within seven days; closed tickets cannot reopen',async t=>{
  const f=fixture(t);const {ticket}=await service.create(auth,input());f.actor.user._id=officer;f.actor.queues=['IT'];
  await service.mutate(auth,ticket.id,'STATUS_CHANGED',{status:'RESOLVED',note:'Access confirmed through investigation.'});
  await assert.rejects(service.mutate(auth,ticket.id,'REOPENED',{note:'The issue returned today.'}),{statusCode:403});
  f.actor.user._id=requester;f.actor.queues=[];
  const result=await service.mutate(auth,ticket.id,'REOPENED',{note:'The issue returned today.'});assert.equal(result.ticket.status,'REOPENED');assert.equal(result.ticket.resolvedAt,null);
  f.tickets[0].status='RESOLVED';f.tickets[0].resolvedAt=new Date(Date.now()-8*86400000);await assert.rejects(service.mutate(auth,ticket.id,'REOPENED',{note:'Old request'}),{statusCode:403});
  f.tickets[0].status='CLOSED';await assert.rejects(service.mutate(auth,ticket.id,'REOPENED',{note:'Closed request'}),{statusCode:403});
});
test('assignment is scoped to a permitted officer, audited, and cannot assign the requester',async t=>{
  const f=fixture(t);const {ticket}=await service.create(auth,input());f.actor.user._id=officer;f.actor.queues=['IT'];
  await assert.rejects(service.mutate(auth,ticket.id,'ASSIGNED',{assigneeId:requester}),{statusCode:400});
  const validate=t.mock.method(access,'officer',async()=>({}));
  const result=await service.mutate(auth,ticket.id,'ASSIGNED',{assigneeId:officer,priority:'HIGH'});
  assert.equal(validate.mock.calls[0].arguments[1],org);assert.equal(validate.mock.calls[0].arguments[2],'IT');assert.equal(result.ticket.assigneeId,officer);assert.equal(result.ticket.history.at(-1).action,'ASSIGNED');
  await assert.rejects(service.mutate(auth,ticket.id,'ASSIGNED',{queue:'HR'}),{statusCode:400});
});
test('default queue grants, explicit IT membership and admin-only access management',async t=>{
  t.mock.method(Membership,'findOne',()=>chain({queues:['IT']}));
  assert.deepEqual(await access.queuesFor({_id:requester,role:'employee'},org),['IT']);assert.deepEqual(await access.queuesFor({_id:officer,role:'hr'},org),['HR','IT']);assert.deepEqual(await access.queuesFor({_id:officer,role:'admin'},org),['IT','HR']);
  const f=fixture(t);await assert.rejects(service.membership(auth,{email:'person@example.com',queues:['IT'],active:true}),{statusCode:403});
  f.actor.user.role='admin';t.mock.method(User,'findOne',()=>chain({_id:requester,employee:{organizationId:otherOrg}}));
  await assert.rejects(service.membership(auth,{email:'person@example.com',queues:['IT'],active:true}),{statusCode:404});
});
test('notifications remain safe when infrastructure fails and exclude another organization',async t=>{
  const updates=t.mock.method(Ticket,'updateOne',async()=>({}));
  t.mock.method(Membership,'find',()=>chain([]));
  t.mock.method(User,'find',()=>chain([{email:'local@example.com',status:'active',employee:{organizationId:org}},{email:'foreign@example.com',status:'active',employee:{organizationId:otherOrg}}]));
  const send=t.mock.method(mail,'sendSupportNotification',async recipients=>{assert.deepEqual(recipients,['local@example.com']);throw Error('SMTP offline');});
  const result=await notifications.notify({_id:requester,organizationId:org,queue:'IT',number:'SUP-test'},'queue','New request');assert.equal(result.status,'failed');assert.equal(send.mock.callCount(),1);assert.equal(updates.mock.callCount(),1);
});
test('support endpoints reject unauthenticated access',async t=>{
  const app=require('../src/app');const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  for(const [method,path] of [['GET','/context'],['GET','/tickets'],['POST','/tickets'],['PUT','/memberships'],['POST',`/tickets/${requester}/messages`]])assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/support${path}`,{method})).status,401);
});
