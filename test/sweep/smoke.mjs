// The smallest sweep: the session list and one conversation. It proves the harness; the areas hold the real coverage.
export const area='smoke';
export const surfaces=[
 {name:'sessions-home',route:'#/',ready:'.session-row, .row, [data-v]'},
 {name:'conversation',route:ctx=>'#/chat/'+ctx.rows[3].id,ready:'#box'},
];
