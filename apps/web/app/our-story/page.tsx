import type { Metadata } from 'next';
import Storefront from '../../components/storefront';
export const metadata:Metadata={title:'Our Story — Wok & Chop',description:'Meet Wok & Chop, a Halal Hakka Chinese kitchen in Kanata, Ontario.'};
export default function StoryPage(){return <Storefront page="story"/>}
