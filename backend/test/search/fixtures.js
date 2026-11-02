'use strict';
/** TEST ONLY. Fictional projects and developers, invented for the search tests: none of these names is a real project or company. */
module.exports = [
  { id: 't-vasant-heights', market: 'in', name: 'Vasant Heights', aliases: ['Vasant Sea Heights'], city: 'Mumbai', locality: 'Worli', neighbours: ['Lower Parel', 'Prabhadevi'],
    developer: { name: 'Vasant Builders', legal: ['Vasant Realty Pvt Ltd'] }, status: 'under_construction', configs: ['2bhk', '3bhk'], features: ['sea_view'],
    phases: [{ name: 'Phase 1', regId: 'P51900012345', status: 'ready', possession: 2022 }, { name: 'Phase 2', regId: 'P51900067890', status: 'under_construction', possession: 2027 }], origin: 'test' },
  { id: 't-shreeji-greens-mum', market: 'in', name: 'Shreeji Greens', city: 'Mumbai', locality: 'Powai', neighbours: ['Andheri East', 'Vikhroli'], developer: { name: 'Shreeji Realty' },
    status: 'under_construction', configs: ['1bhk', '2bhk'], features: ['lake_view'], phases: [{ name: 'Phase 1', regId: 'P51800011111', possession: 2026 }], origin: 'test' },
  { id: 't-shreeji-greens-pune', market: 'in', name: 'Shreeji Greens', city: 'Pune', locality: 'Hinjewadi', developer: { name: 'Shreeji Realty' }, phases: [{ name: 'Phase 1', regId: 'P52100022222' }], origin: 'test' },
  { id: 't-vasant-vihar', market: 'in', name: 'Vasant Vihar', city: 'Thane', locality: 'Thane West', developer: { name: 'Kalpak Developers' },
    phases: [{ name: 'Phase I', regId: 'P51700033331' }, { name: 'Phase II', regId: 'P51700033332' }], origin: 'test' },
  { id: 't-skyline-towers', market: 'in', name: 'Skyline Towers', city: 'Mumbai', locality: 'Andheri West', neighbours: ['Juhu', 'Versova'], developer: { name: 'Arihant Spaces' },
    phases: [{ name: 'Tower A', regId: 'P51800033333' }, { name: 'Tower B', regId: 'P51800044444' }], origin: 'test' },
  { id: 't-park-royal', market: 'in', name: 'Park Royal', city: 'Mumbai', locality: 'Chembur', developer: { name: 'Mehta Group' }, regIds: ['P51800055555'], origin: 'test' },
  { id: 't-marina-crest', market: 'ae', name: 'Marina Crest', aliases: ['Crest Residences'], city: 'Dubai', locality: 'Dubai Marina', developer: { name: 'Al Noor Properties' }, regIds: ['DXB20231234'], origin: 'test' },
  { id: 't-thames-wharf', market: 'uk', name: 'Thames Wharf', city: 'London', locality: 'Battersea', developer: { name: 'Riverside Homes Ltd' }, origin: 'test' },
];
