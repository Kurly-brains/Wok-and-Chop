import type { Metadata } from 'next';
import Storefront from '../../components/storefront';
export const metadata:Metadata={title:'Menu — Wok & Chop',description:'Explore the Wok & Chop sample Hakka Chinese menu. Noodles, rice, small plates and dishes from the wok.'};
export default function MenuPage(){return <Storefront page="menu"/>}
