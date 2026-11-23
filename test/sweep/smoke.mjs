// The smallest sweep: the session list and one conversation. It proves the harness; the areas hold the real coverage.
export const area='smoke';
export const surfaces=[
 {name:'sessions-home',route:'#/',ready:'.session-row, .row, [data-v]',allow:{covered:[/^button\.(pin-toggle|session-more)/]}}, // the last row's pin and options under the New button until scrolled, as in the core area
 {name:'conversation',route:ctx=>'#/chat/'+ctx.rows[3].id,ready:'#box'},
];
