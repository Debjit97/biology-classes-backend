import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshSessionDto {
  @IsString()
  @MinLength(40)
  @MaxLength(256)
  refreshToken!: string;
}
