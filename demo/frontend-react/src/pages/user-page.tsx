/* demo/frontend-react/src/pages/user-page.tsx */

import { useSeamData } from "@canmi/seam-react";

interface UserData {
  user: {
    id: number;
    name: string;
    email: string;
    avatar: string | null;
  };
}

export function UserPage() {
  const { user } = useSeamData<UserData>();

  return (
    <div className="user-page">
      <h1>{user.name}</h1>
      <p>{user.email}</p>
      <p>ID: {user.id}</p>
      {user.avatar && <img src={user.avatar} alt={`${user.name}'s avatar`} />}
    </div>
  );
}
